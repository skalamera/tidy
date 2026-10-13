import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { computeFederal } from '../engine/federal/form1040';
import { formatUsd } from '../engine/money';
import { amountAt } from '../core/amount';
import { deriveFacts } from '../core/deriveFacts';
import { applyOverrides } from '../core/overrides';
import { reconcileQuestions } from '../core/reconcile';
import { buildView, type AppView } from '../core/view';
import { AI_NAMES, type AiProvider } from '../shared/ai';
import { IPC, type ExportResult, type Result, type ScreenContext } from '../shared/ipc';
import type { AppState, SectionId } from '../shared/state';
import type { LlmClient } from './ai/llm';
import { runChatTurn, type ChatModel, type ToolHandlers } from './ai/chat';
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

/** The app's backend: owns every state change, the reading queue and chat, and pushes a fresh view on each change. */
export class TidyService {
  private conn: Connection | null = null;
  private screen: ScreenContext = { view: 'welcome', sectionId: null, documentId: null, page: null };
  private readonly waiting: string[] = [];
  private readonly reading = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private chatBusy = false;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ServiceDeps) {
    deps.store.on('change', () => this.publish());
  }

  async init(): Promise<void> {
    const saved = await this.deps.aiKeys.load();
    if (saved) this.conn = await this.deps.connect(saved.provider, saved.key, false);
    await this.deps.store.update((d) => {
      for (const doc of d.documents) if (doc.status === 'reading') doc.status = 'queued'; // the app quit mid-read
      d.questions = reconcileQuestions(d);
    });
    this.pump();
  }

  view(): AppView {
    return buildView(this.deps.store.get(), { aiProvider: this.conn?.provider ?? null });
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
    } catch {
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
      d.questions = reconcileQuestions(d);
    });
    await this.deps.store.deleteDocument(id);
  }

  getDocumentBytes = (id: string) => this.deps.store.getDocument(id).then((b) => new Uint8Array(b));

  private ingestDeps() {
    return { store: this.deps.store, llm: this.conn?.llm as LlmClient, pdf: this.deps.pdf, now: this.deps.now, newId: this.deps.newId };
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
        if (q) Object.assign(q, { answer, answeredAt: this.deps.now() });
      }
      d.questions = reconcileQuestions(d);
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

  async sendChat(text: string): Promise<void> {
    const conn = this.conn;
    if (this.chatBusy || !conn || text.trim() === '') return;
    this.chatBusy = true;
    const before = new Set(this.deps.store.get().proposals.map((p) => p.id));
    const say = (role: 'user' | 'assistant', t: string, proposalIds: string[] = []) =>
      this.deps.store.update((d) => {
        d.chat.messages.push({ id: this.deps.newId(), role, text: t, at: this.deps.now(), proposalIds });
      });
    try {
      await say('user', text);
      const chat = this.deps.store.get().chat;
      const out = await runChatTurn({
        model: conn.chat,
        // A transcript only ever goes back to the AI that wrote it. Before Gemini support, that was always Claude.
        transcript: (chat.transcriptBy ?? 'anthropic') === conn.provider ? chat.transcript : [],
        userText: text,
        context: this.chatContext(this.view()),
        handlers: this.chatHandlers(),
        onText: (delta) => this.deps.emit(IPC.chatDelta, delta),
      });
      await this.deps.store.update((d) => {
        d.chat.transcript = out.transcript;
        d.chat.transcriptBy = conn.provider;
      });
      const created = this.deps.store
        .get()
        .proposals.filter((p) => !before.has(p.id))
        .map((p) => p.id);
      await say('assistant', out.text, created);
    } catch {
      await say('assistant', `I couldn’t reach ${AI_NAMES[conn.provider].ai} just now. Check your internet connection and try again.`);
    } finally {
      this.chatBusy = false;
    }
  }

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
      d.questions = reconcileQuestions(d);
    });
    return { ok: true };
  }

  // ---------- export ----------

  async exportPackage(): Promise<ExportResult> {
    if (!this.view().canExport) return { ok: false, error: 'Approve every section and fix anything marked “Must fix” first.' };
    const file = await this.deps.savePath('2025 Tax Return.pdf');
    if (!file) return { ok: false, error: 'Cancelled.' };
    await this.deps.writeFile(file, await this.deps.buildPackage(this.deps.store.get()));
    return { ok: true, path: file };
  }
}
