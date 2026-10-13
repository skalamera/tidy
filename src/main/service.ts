import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { computeFederal } from '../engine/federal/form1040';
import { formatUsd } from '../engine/money';
import { amountAt } from '../core/amount';
import { deriveFacts } from '../core/deriveFacts';
import { applyOverrides } from '../core/overrides';
import { reconcile } from '../core/reconcile';
import { searchChats as matchingChats } from '../core/chatSearch';
import { buildView, problemView, type AppView, type ViewContext } from '../core/view';
import { AI_NAMES, type AiProvider } from '../shared/ai';
import { normalAnswer } from '../shared/answers';
import { chatTitle, type ChatHit, type ChatMessage, type ChatQuery, type ChatView, type Conversation } from '../shared/chat';
import { IPC, type ExportResult, type Result, type ScreenContext } from '../shared/ipc';
import type { AppState, SectionId } from '../shared/state';
import type { LlmClient } from './ai/llm';
import { runChatTurn, type ChatModel, type ToolHandlers } from './ai/chat';
import { aiFailure } from './ai/errors';
import type { ChatStore } from './chats';
import { keyProblem } from './apiKey';
import type { LawSearch } from './law/search';
import { addFile, processDocument, type PdfTools } from './pipeline/ingest';
import type { ReturnStore } from './store';

export interface Connection {
  provider: AiProvider;
  llm: LlmClient;
  chat: ChatModel;
}

export interface ServiceDeps {
  store: ReturnStore;
  /** Saved chats, kept apart from the return. */
  chats: ChatStore;
  /** Records an unexpected error for debugging. The user sees a plain sentence instead. */
  log: (where: string, error: unknown) => void;
  /** The saved API key and which AI it is for, encrypted on disk. */
  aiKeys: { load(): Promise<{ provider: AiProvider; key: string } | null>; save(provider: AiProvider, key: string): Promise<void> };
  pdf: PdfTools;
  law: LawSearch;
  /** Build clients for an AI and key. With verify = true it makes one cheap API call and throws if the key is rejected. */
  connect: (provider: AiProvider, apiKey: string, verify: boolean) => Promise<Connection>;
  now: () => string;
  newId: () => string;
  emit: (channel: string, payload: unknown) => void;
  pickPaths: () => Promise<string[]>;
  buildPackage: (state: AppState) => Promise<Uint8Array>;
  savePath: (defaultName: string) => Promise<string | null>;
  writeFile: (file: string, bytes: Uint8Array) => Promise<void>;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PARALLEL_READS = 2;

/** Before chat history, the return's state held one chat. */
interface ChatBeforeHistory {
  messages: ChatMessage[];
  transcript: unknown[];
  transcriptBy?: AiProvider;
}
/** That chat's id once it moves into the saved chats. */
export const CHAT_BEFORE_HISTORY = 'chat-before-history';

/** The app's backend: owns every state change, the reading queue and chat, and pushes a fresh view on each change. */
export class TidyService {
  private conn: Connection | null = null;
  private screen: ScreenContext = { view: 'welcome', sectionId: null, documentId: null, page: null };
  private readonly waiting: string[] = [];
  private readonly reading = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private chatBusy = false;
  /** The chat Tidy is answering right now. */
  private busyId: string | null = null;
  /** The last error from working out the return, so a lasting one is logged once, not on every change. */
  private viewError: string | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ServiceDeps) {
    deps.store.on('change', () => this.publish());
    deps.chats.on('change', () => this.publish());
  }

  async init(): Promise<void> {
    const saved = await this.deps.aiKeys.load();
    if (saved) this.conn = await this.deps.connect(saved.provider, saved.key, false);
    await this.moveChatBeforeHistory();
    await this.deps.store.update((d) => {
      for (const doc of d.documents) if (doc.status === 'reading') doc.status = 'queued'; // the app quit mid-read
      reconcile(d);
    });
    this.pump();
  }

  /** The chat saved inside the return before chat history becomes the first saved chat, still open. */
  private async moveChatBeforeHistory(): Promise<void> {
    const old = (this.deps.store.get() as AppState & { chat?: ChatBeforeHistory }).chat;
    if (!old) return;
    const { chats } = this.deps;
    if (old.messages.length > 0 && !chats.get(CHAT_BEFORE_HISTORY)) {
      const firstQuestion = old.messages.find((m) => m.role === 'user') ?? old.messages[0];
      await chats.save({
        id: CHAT_BEFORE_HISTORY,
        title: chatTitle(firstQuestion.text),
        createdAt: old.messages[0].at,
        updatedAt: old.messages[old.messages.length - 1].at,
        messages: old.messages,
        transcript: old.transcript,
        transcriptBy: old.transcriptBy ?? 'anthropic', // before Gemini support it was always Claude
      });
      await chats.setCurrent(CHAT_BEFORE_HISTORY);
    }
    await this.deps.store.update((d) => {
      delete (d as AppState & { chat?: unknown }).chat;
    });
  }

  /** Never throws. If working out the return fails (a bug), the error is logged and the screen says so plainly. */
  view(): AppView {
    const state = this.deps.store.get();
    const ctx: ViewContext = { aiProvider: this.conn?.provider ?? null, chat: this.chatView() };
    try {
      const v = buildView(state, ctx);
      this.viewError = null;
      return v;
    } catch (e) {
      const seen = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (seen !== this.viewError) {
        this.viewError = seen;
        this.deps.log('Working out the return', e);
      }
      return problemView(state, ctx);
    }
  }

  private chatView(): ChatView {
    const { chats } = this.deps;
    const currentId = chats.currentId();
    return {
      currentId,
      messages: (currentId !== null && chats.get(currentId)?.messages) || [],
      conversations: chats
        .all()
        .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length })),
      busyId: this.busyId,
    };
  }

  /** Resolves when no document is being read. For tests and orderly shutdown. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  private publish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.deps.emit(IPC.viewChanged, this.view());
    }, 50);
  }

  // ---------- onboarding & settings ----------

  completeWelcome = () =>
    this.deps.store.update((d) => {
      d.onboarding.welcomed = true;
    });

  skipPriorYear = () =>
    this.deps.store.update((d) => {
      d.onboarding.priorYearSkipped = true;
    });

  async setApiKey(provider: AiProvider, raw: string): Promise<Result> {
    const key = raw.trim();
    const problem = keyProblem(provider, key);
    if (problem) return { ok: false, error: problem };
    let conn: Connection;
    try {
      conn = await this.deps.connect(provider, key, true);
    } catch (e) {
      this.deps.log('Connecting the AI', e);
      const failure = aiFailure(provider, e, 'chat');
      if (failure && ['offline', 'busy', 'rate_limited'].includes(failure.problem)) return { ok: false, error: failure.text };
      return { ok: false, error: `${AI_NAMES[provider].company} didn’t accept that key. Check it and try again.` };
    }
    await this.deps.aiKeys.save(provider, key);
    this.conn = conn;
    this.publish();
    this.pump();
    return { ok: true };
  }

  // ---------- documents ----------

  async pickFiles(): Promise<void> {
    await this.addPaths(await this.deps.pickPaths());
  }

  async addPaths(paths: string[]): Promise<{ added: number; duplicates: number; rejected: string[] }> {
    const out = { added: 0, duplicates: 0, rejected: [] as string[] };
    for (const p of paths) {
      try {
        const bytes = await readFile(p);
        if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path.basename(p)} is over 50 MB.`);
        const r = await addFile(this.ingestDeps(), path.basename(p), bytes);
        if (r.duplicate) out.duplicates++;
        else out.added++;
      } catch (e) {
        out.rejected.push((e as Error).message);
      }
    }
    this.pump();
    return out;
  }

  async retryDocument(id: string): Promise<void> {
    await this.deps.store.update((d) => {
      const doc = d.documents.find((x) => x.id === id);
      if (doc) Object.assign(doc, { status: 'queued', error: null });
    });
    this.pump();
  }

  async removeDocument(id: string): Promise<void> {
    await this.deps.store.update((d) => {
      d.documents = d.documents.filter((x) => x.id !== id);
      for (const doc of d.documents) if (doc.supersededBy === id) doc.supersededBy = null;
      reconcile(d);
    });
    await this.deps.store.deleteDocument(id);
  }

  getDocumentBytes = (id: string) => this.deps.store.getDocument(id).then((b) => new Uint8Array(b));

  private ingestDeps() {
    return {
      store: this.deps.store,
      llm: this.conn?.llm as LlmClient,
      provider: this.conn?.provider ?? 'anthropic',
      pdf: this.deps.pdf,
      now: this.deps.now,
      newId: this.deps.newId,
    };
  }

  /** Reads at most two documents at a time. Documents wait as "queued" until an API key exists. */
  private pump(): void {
    if (!this.conn) return;
    for (const d of this.deps.store.get().documents) {
      if (d.status === 'queued' && !this.waiting.includes(d.id) && !this.reading.has(d.id)) this.waiting.push(d.id);
    }
    while (this.inFlight.size < MAX_PARALLEL_READS && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      this.reading.add(id);
      const job: Promise<void> = processDocument(this.ingestDeps(), id).finally(() => {
        this.inFlight.delete(job);
        this.reading.delete(id);
        this.pump();
      });
      this.inFlight.add(job);
    }
  }

  // ---------- questions & approvals ----------

  async answer(questionId: string, answer: string): Promise<void> {
    await this.deps.store.update((d) => {
      if (questionId.startsWith('expected:')) {
        const e = d.expected.find((x) => `expected:${x.key}` === questionId);
        if (e) e.dismissed = true;
      } else if (questionId.startsWith('confirm:')) {
        const [, docId, idx, field] = questionId.split(':');
        const doc = d.documents.find((x) => x.id === docId);
        const a = doc?.extractions[Number(idx)] ? amountAt(doc.extractions[Number(idx)].data, field) : null;
        if (doc && a) {
          if (answer !== 'yes') {
            a.amount = (Number.parseInt(answer, 10) / 100).toFixed(2);
            a.quote = 'Corrected by you';
          }
          doc.fieldChecks[`${idx}:${field}`] = 'verified';
        }
      } else {
        const q = d.questions.find((x) => x.id === questionId);
        const value = q ? normalAnswer(q.kind, answer) : null; // the screen checks too; this is the trust boundary
        if (q && value !== null) Object.assign(q, { answer: value, answeredAt: this.deps.now() });
      }
      reconcile(d);
    });
  }

  async approve(sectionId: SectionId): Promise<Result> {
    const s = this.view().sections.find((x) => x.id === sectionId);
    if (!s || (s.status !== 'ready' && s.status !== 'needs_reapproval'))
      return { ok: false, error: 'This section isn’t ready to approve yet.' };
    await this.deps.store.update((d) => {
      d.approvals[sectionId] = { approvedAt: this.deps.now(), snapshotHash: s.hash };
    });
    return { ok: true };
  }

  setScreen(ctx: ScreenContext): void {
    this.screen = ctx;
  }

  // ---------- chat ----------

  /** What the user sees right now, in words, for the AI. Rebuilt on every message. */
  chatContext(v: AppView): string {
    const s = this.screen.sectionId ? v.sections.find((x) => x.id === this.screen.sectionId) : null;
    const doc = this.screen.documentId ? v.documents.find((x) => x.id === this.screen.documentId) : null;
    const open = v.questions.filter((q) => q.answer === null && q.sectionId === this.screen.sectionId).map((q) => `- ${q.prompt}`);
    const money = v.summary.refund > 0 ? `refund ${formatUsd(v.summary.refund)}` : `owed ${formatUsd(v.summary.owed)}`;
    return [
      `screen: ${s ? `section "${s.title}" (status: ${s.status})` : this.screen.view}`,
      doc ? `document open: ${doc.kind} from ${doc.issuer ?? doc.fileName}, page ${this.screen.page ?? 1}` : null,
      `next step shown to the user: ${v.now.title}`,
      `federal return so far: AGI ${formatUsd(v.summary.agi)}; taxable income ${formatUsd(v.summary.taxableIncome)}; total tax ${formatUsd(v.summary.totalTax)}; ${money}`,
      v.summary.state ? `${v.summary.state.code} return so far: total tax ${formatUsd(v.summary.state.totalTax)}` : null,
      open.length ? `open questions on this screen:\n${open.join('\n')}` : null,
      v.flags.length ? `problems:\n${v.flags.map((f) => `- ${f.title}`).join('\n')}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private chatHandlers(): ToolHandlers {
    return {
      get_return_summary: async () => {
        const v = this.view();
        return { summary: v.summary, sections: v.sections.map((s) => ({ id: s.id, status: s.status })), problems: v.flags };
      },
      get_section: async (i) => {
        const v = this.view();
        const id = i.section_id as SectionId;
        return { cards: v.details[id], questions: v.questions.filter((q) => q.sectionId === id) };
      },
      explain_line: async (i) =>
        computeFederal(deriveFacts(this.deps.store.get()))
          .ledger.all()
          .find((l) => l.id === i.line_id) ?? { error: 'No such line' },
      list_documents: async () => this.view().documents,
      search_tax_law: async (i) => this.deps.law.search(String(i.query)),
      propose_change: async (i) => {
        const id = this.deps.newId();
        await this.deps.store.update((d) => {
          d.proposals.push({
            id,
            sectionId: i.section_id as SectionId,
            description: String(i.description),
            path: i.path as string[],
            value: i.value,
            reason: String(i.reason),
            status: 'pending',
            createdAt: this.deps.now(),
          });
        });
        return { proposal_id: id, status: 'Shown to the user with Accept and Reject buttons. Nothing has changed yet.' };
      },
      open_section: async (i) => {
        this.deps.emit(IPC.navigate, i.section_id);
        return { ok: true };
      },
    };
  }

  /** Asks in the open chat, or starts a new one with this as its first question. */
  async sendChat(text: string): Promise<void> {
    const conn = this.conn;
    if (this.chatBusy || !conn || text.trim() === '') return;
    this.chatBusy = true;
    const { chats } = this.deps;
    try {
      let id = chats.currentId();
      if (id === null || !chats.get(id)) {
        id = this.deps.newId();
        const at = this.deps.now();
        await chats.save({ id, title: chatTitle(text), createdAt: at, updatedAt: at, messages: [], transcript: [], transcriptBy: null });
        await chats.setCurrent(id);
      }
      this.busyId = id;
      await this.answerIn(conn, id, text);
    } finally {
      this.busyId = null;
      this.chatBusy = false;
      this.publish();
    }
  }

  /** Adds the question and its answer to chat `id`. If the AI fails, the answer says what went wrong, plainly. */
  private async answerIn(conn: Connection, id: string, text: string): Promise<void> {
    const { chats } = this.deps;
    const before = new Set(this.deps.store.get().proposals.map((p) => p.id));
    const add = async (m: Omit<ChatMessage, 'id' | 'at'>, patch: Partial<Conversation> = {}) => {
      const c = chats.get(id);
      if (!c) return; // deleted while Tidy was answering
      const at = this.deps.now();
      await chats.save({ ...c, ...patch, updatedAt: at, messages: [...c.messages, { id: this.deps.newId(), at, ...m }] });
    };
    try {
      await add({ role: 'user', text, proposalIds: [] });
      const c = chats.get(id);
      const out = await runChatTurn({
        model: conn.chat,
        transcript: c?.transcriptBy === conn.provider ? c.transcript : [], // a transcript only goes back to the AI that wrote it
        userText: text,
        context: this.chatContext(this.view()),
        handlers: this.chatHandlers(),
        onText: (delta) => this.deps.emit(IPC.chatDelta, delta),
      });
      const created = this.deps.store
        .get()
        .proposals.filter((p) => !before.has(p.id))
        .map((p) => p.id);
      await add({ role: 'assistant', text: out.text, proposalIds: created }, { transcript: out.transcript, transcriptBy: conn.provider });
    } catch (e) {
      this.deps.log('Chat', e);
      const failure = aiFailure(conn.provider, e, 'chat');
      await add({
        role: 'assistant',
        text: failure?.text ?? `Something went wrong on Tidy’s side, so ${AI_NAMES[conn.provider].ai} couldn’t answer. Try again.`,
        proposalIds: [],
        error: { changeAi: failure?.changeAi ?? false },
      });
    }
  }

  /** The panel shows a new, empty chat. It's saved once its first question is sent. */
  newChat = (): Promise<void> => this.deps.chats.setCurrent(null);

  async openChat(id: string): Promise<void> {
    if (this.deps.chats.get(id)) await this.deps.chats.setCurrent(id);
  }

  deleteChat = (id: string): Promise<void> => this.deps.chats.remove(id);

  searchChats = async (query: ChatQuery): Promise<ChatHit[]> => matchingChats(this.deps.chats.all(), query);

  async decideProposal(id: string, accept: boolean): Promise<Result> {
    const p = this.deps.store.get().proposals.find((x) => x.id === id);
    if (!p || p.status !== 'pending') return { ok: false, error: 'That suggestion is no longer open.' };
    const mark = (status: 'accepted' | 'rejected') =>
      this.deps.store.update((d) => {
        d.proposals.find((x) => x.id === id)!.status = status;
      });
    if (!accept) {
      await mark('rejected');
      return { ok: true };
    }
    const override = {
      id: this.deps.newId(),
      path: p.path,
      value: p.value,
      reason: p.reason,
      createdAt: this.deps.now(),
      createdBy: 'ai_proposal' as const,
    };
    try {
      applyOverrides(deriveFacts(this.deps.store.get()), [override]); // throws if the path no longer exists
    } catch {
      await mark('rejected');
      return { ok: false, error: 'That change no longer fits your return, so it wasn’t applied.' };
    }
    await this.deps.store.update((d) => {
      d.overrides.push(override);
      d.proposals.find((x) => x.id === id)!.status = 'accepted';
      reconcile(d);
    });
    return { ok: true };
  }

  // ---------- export ----------

  async exportPackage(): Promise<ExportResult> {
    if (!this.view().canExport) return { ok: false, error: 'Approve every section and fix anything marked “Must fix” first.' };
    const file = await this.deps.savePath('2025 Tax Return.pdf');
    if (!file) return { ok: false, error: 'Cancelled.' };
    try {
      await this.deps.writeFile(file, await this.deps.buildPackage(this.deps.store.get()));
    } catch (e) {
      this.deps.log('Making the PDF', e);
      return {
        ok: false,
        error: 'Tidy couldn’t make your PDF, so nothing was saved. Try again, and if it keeps happening, quit and reopen Tidy.',
      };
    }
    return { ok: true, path: file };
  }
}
