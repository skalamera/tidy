import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FakeLlm } from '../../src/main/ai/llm';
import { CLASSIFY_SYSTEM } from '../../src/main/ai/prompts';
import type { ChatModel } from '../../src/main/ai/chat';
import { LawSearch } from '../../src/main/law/search';
import type { PdfTools } from '../../src/main/pipeline/ingest';
import { TidyService, type ServiceDeps } from '../../src/main/service';
import { ChatStore } from '../../src/main/chats';
import { ReturnStore } from '../../src/main/store';
import { buildView, type AppView } from '../../src/core/view';
import { reconcile } from '../../src/core/reconcile';
import type { AiProvider } from '../../src/shared/ai';
import { IPC } from '../../src/shared/ipc';
import { doc, priorYear, w2Extraction } from '../fixtures/state';

// buildView runs for real unless a test makes it throw, the way an engine bug would.
vi.mock('../../src/core/view', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/view')>();
  return { ...real, buildView: vi.fn(real.buildView) };
});
const { buildView: realBuildView } = await vi.importActual<typeof import('../../src/core/view')>('../../src/core/view');
afterEach(() => void vi.mocked(buildView).mockImplementation(realBuildView));

const NOW = () => '2026-10-13T12:00:00.000Z';
const GOOD_KEY = `sk-ant-${'a'.repeat(30)}`;
const GEMINI_KEY = `AIza${'g'.repeat(35)}`;
const ACCEPTED: Record<AiProvider, string> = { anthropic: GOOD_KEY, gemini: GEMINI_KEY };

const pdf: PdfTools = {
  pageCount: async () => 1,
  pageTexts: async () => ['Form W-2 Wage and Tax Statement 2025 Acme Corp 85,000.00 11,000.00 85,000.00 5,270.00 1,232.50'],
  slicePages: async (b) => b,
};

const respond = (call: { system: string }) =>
  call.system === CLASSIFY_SYSTEM
    ? {
        docType: 'w2',
        taxYear: 2025,
        issuerName: 'Acme Corp',
        recipientName: 'Alex Rivera',
        isCorrected: false,
        confidence: 'high',
        parts: [],
      }
    : w2Extraction().data;

/** A chat model whose every reply fails the way the API failed. */
const failingChat = (error: unknown): ChatModel => ({
  userMessage: (texts) => ({ role: 'user', texts }),
  toolResultsMessage: (results) => ({ role: 'user', results }),
  turn: async () => {
    throw error;
  },
});

/** `prepare` runs before the service starts, to set up what an earlier version of Tidy saved. */
async function setup(overrides: Partial<ServiceDeps> = {}, prepare?: (store: ReturnStore, chats: ChatStore) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tidy-service-'));
  const store = await ReturnStore.open(path.join(dir, 'store'), randomBytes(32), NOW);
  const chats = await ChatStore.open(path.join(dir, 'chats'), randomBytes(32));
  await prepare?.(store, chats);
  const lawFile = path.join(dir, 'chunks.json');
  await writeFile(lawFile, '[]');
  let n = 0;
  const saved: string[] = [];
  const emitted: string[] = [];
  const views: AppView[] = [];
  const logs: string[] = [];
  /** Every history the chat model was sent. It always answers "Hi". */
  const histories: unknown[][] = [];
  const chat: ChatModel = {
    userMessage: (texts) => ({ role: 'user', texts }),
    toolResultsMessage: (results) => ({ role: 'user', results }),
    turn: async (messages) => {
      histories.push(structuredClone(messages));
      return { message: { role: 'assistant', text: 'Hi' }, text: 'Hi', calls: [] };
    },
  };
  const deps: ServiceDeps = {
    store,
    chats,
    aiKeys: { load: async () => null, save: async (provider, key) => void saved.push(`${provider}:${key}`) },
    pdf,
    law: await LawSearch.load(lawFile),
    connect: async (provider, key) => {
      if (key !== ACCEPTED[provider]) throw new Error('401');
      return { provider, llm: new FakeLlm(respond), chat };
    },
    now: NOW,
    newId: () => `id${++n}`,
    emit: (channel, payload) => {
      emitted.push(channel);
      if (channel === IPC.viewChanged) views.push(payload as AppView);
    },
    log: (where, e) => void logs.push(`${where}: ${e instanceof Error ? e.message : String(e)}`),
    pickPaths: async () => [],
    buildPackage: async () => new Uint8Array([37, 80, 68, 70]),
    savePath: async () => path.join(dir, 'out.pdf'),
    writeFile: (file, bytes) => writeFile(file, bytes),
    ...overrides,
  };
  const service = new TidyService(deps);
  await service.init();
  const w2File = path.join(dir, 'acme-w2.pdf');
  await writeFile(w2File, '%PDF-1.7 acme');
  return { service, store, chats, saved, emitted, views, logs, w2File, histories, deps };
}

describe('TidyService', () => {
  it('rejects malformed and refused API keys without saving them', async () => {
    const { service, saved } = await setup();
    expect(await service.setApiKey('anthropic', 'hello')).toEqual({ ok: false, error: expect.stringContaining('sk-ant-') });
    expect(await service.setApiKey('anthropic', `sk-ant-${'b'.repeat(30)}`)).toEqual({
      ok: false,
      error: expect.stringContaining('didn’t accept'),
    });
    expect(saved).toEqual([]);
    expect(service.view().aiProvider).toBeNull();
  });

  it('queues documents until a key exists, then reads them', async () => {
    const { service, store, saved, w2File } = await setup();
    expect(await service.addPaths([w2File, w2File])).toEqual({ added: 1, duplicates: 1, rejected: [] });
    expect(store.get().documents[0].status).toBe('queued');
    expect(await service.setApiKey('anthropic', ` ${GOOD_KEY} `)).toEqual({ ok: true });
    expect(saved).toEqual([`anthropic:${GOOD_KEY}`]);
    await service.idle();
    const doc = store.get().documents[0];
    expect(doc.status).toBe('done');
    expect(service.view().details.wages[0].title).toContain('Acme');
  });

  it('connects Gemini with its own key and never replays a Claude transcript to it', async () => {
    const { service, chats, saved, histories } = await setup({}, async (_store, chats) => {
      await chats.save({
        id: 'c1',
        title: 'Hi',
        createdAt: NOW(),
        updatedAt: NOW(),
        messages: [],
        transcript: [{ role: 'user', content: 'asked Claude earlier' }],
        transcriptBy: 'anthropic',
      });
      await chats.setCurrent('c1');
    });
    expect(await service.setApiKey('gemini', GOOD_KEY)).toEqual({ ok: false, error: expect.stringContaining('Claude key') });
    expect(await service.setApiKey('gemini', `AIza${'x'.repeat(35)}`)).toEqual({
      ok: false,
      error: 'Google didn’t accept that key. Check it and try again.',
    });
    expect(await service.setApiKey('gemini', GEMINI_KEY)).toEqual({ ok: true });
    expect(saved).toEqual([`gemini:${GEMINI_KEY}`]);
    expect(service.view().aiProvider).toBe('gemini');
    await service.sendChat('Hello');
    expect(histories[0]).toHaveLength(1); // just the new question
    expect(chats.get('c1')?.transcriptBy).toBe('gemini');
    await service.sendChat('And now?');
    expect(histories[1]).toHaveLength(3); // Gemini's own transcript does come back
  });

  it('tells a refused key apart from no connection', async () => {
    const { service, saved } = await setup({
      connect: async () => {
        throw new Anthropic.APIConnectionError({ message: 'Connection error.' });
      },
    });
    expect(await service.setApiKey('anthropic', GOOD_KEY)).toEqual({
      ok: false,
      error: 'Tidy couldn’t reach Claude. Check your internet connection and try again.',
    });
    expect(saved).toEqual([]);
  });

  it('expects only what the 2024 return lists: a list left by a removed return is cleared, and removing the return clears its own', async () => {
    const { service, store } = await setup({}, (store) =>
      store.update((d) => {
        d.documents.push(doc('py', [priorYear()]));
        d.expected = [{ key: 'f1099_int:old-bank', name: 'Old Bank', form: 'f1099_int', dismissed: true }]; // from a return removed earlier
      }),
    );
    expect(store.get().expected.map((e) => e.key)).toEqual(['w2:acme', 'f1099_div:charles-schwab']);
    await service.answer('expected:w2:acme', 'not this year');
    expect(store.get().expected.map((e) => e.dismissed)).toEqual([true, false]);
    await service.removeDocument('py');
    expect(store.get().expected).toEqual([]);
    expect(store.get().questions.filter((q) => q.id.startsWith('expected:'))).toEqual([]);
  });

  it('reconnects to the saved AI at startup', async () => {
    const { service } = await setup({ aiKeys: { load: async () => ({ provider: 'gemini', key: GEMINI_KEY }), save: async () => {} } });
    expect(service.view().aiProvider).toBe('gemini');
  });

  it('applies an accepted chat proposal as an override, refuses to apply it twice, and undoes it', async () => {
    const { service, store } = await setup();
    const wages = ['w2s', 'w2-d1-0', 'box1Wages'];
    await store.update((d) => {
      d.documents.push(doc('d1', [w2Extraction()]));
      d.proposals.push({
        id: 'p1',
        sectionId: 'wages',
        description: 'Fix a typo',
        path: wages,
        value: 8_600_000,
        reason: 'The scan was blurry',
        status: 'pending',
        createdAt: NOW(),
      });
    });
    expect(await service.decideProposal('p1', true)).toEqual({ ok: true });
    expect(store.get().overrides).toMatchObject([
      {
        path: wages,
        value: 8_600_000,
        createdBy: 'ai_proposal',
        sectionId: 'wages',
        proposalId: 'p1',
        change: { label: 'W-2 from Acme Corp: Box 1 wages', before: '$85,000', after: '$86,000' },
      },
    ]);
    expect(service.view().overrides).toMatchObject([{ sectionId: 'wages', applied: true }]);
    expect(await service.decideProposal('p1', true)).toEqual({ ok: false, error: expect.any(String) });

    const overrideId = store.get().overrides[0].id;
    expect(await service.undoOverride(overrideId)).toEqual({ ok: true });
    expect(store.get().overrides).toEqual([]);
    expect(store.get().proposals[0].status).toBe('undone');
    expect(await service.undoOverride(overrideId)).toEqual({ ok: false, error: expect.any(String) });
  });

  it('turns only a valid suggestion from chat into a card, worded by Tidy instead of the AI', async () => {
    const outputs: unknown[] = [];
    let round = 0;
    const chat: ChatModel = {
      userMessage: (texts) => ({ role: 'user', texts }),
      toolResultsMessage: (results) => {
        outputs.push(...results.map((r) => r.output));
        return { role: 'user', results };
      },
      turn: async () => {
        round++;
        if (round > 1) return { message: { role: 'assistant', text: 'Done' }, text: 'Done', calls: [] };
        const propose = (id: string, path: unknown, value: unknown) => ({
          id,
          name: 'propose_change',
          input: { section_id: 'wages', description: 'Just a small typo fix', path, value, reason: 'Blurry scan' },
        });
        return {
          message: { role: 'assistant' },
          text: '',
          calls: [
            { id: 'c1', name: 'find_facts', input: { query: 'acme box 1' } },
            propose('c2', ['__proto__', 'polluted'], 1),
            propose('c3', ['w2s', 'w2-d1-0', 'box1Wages'], '8600000'),
            propose('c4', ['filingStatus'], 'single'),
            propose('c5', ['w2s', 'w2-d1-0', 'box1Wages'], 0),
          ],
        };
      },
    };
    const { service, store } = await setup({ connect: async (provider) => ({ provider, llm: new FakeLlm(respond), chat }) }, async (s) =>
      s.update((d) => void d.documents.push(doc('d1', [w2Extraction()]))),
    );
    await service.setApiKey('anthropic', GOOD_KEY);
    await service.sendChat('My wages look wrong');
    expect(outputs[0]).toEqual({
      facts: [{ path: ['w2s', 'w2-d1-0', 'box1Wages'], label: 'W-2 from Acme Corp: Box 1 wages', value: 8_500_000 }],
      total: 1,
    });
    expect(outputs.slice(1, 4)).toEqual([{ error: expect.any(String) }, { error: expect.any(String) }, { error: expect.any(String) }]);
    expect(outputs[4]).toEqual({ proposal_id: expect.any(String), status: expect.any(String) });
    expect(store.get().proposals).toMatchObject([
      {
        path: ['w2s', 'w2-d1-0', 'box1Wages'],
        value: 0,
        change: { label: 'W-2 from Acme Corp: Box 1 wages', before: '$85,000', after: '$0' },
      },
    ]);
    expect(service.view().proposals).toMatchObject([{ fits: true, change: { after: '$0' }, overrideId: null }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a proposal whose change no longer fits, or that the math can’t handle', async () => {
    const { service, store } = await setup();
    await store.update((d) => {
      d.documents.push(doc('d1', [w2Extraction()]));
      d.proposals.push(
        {
          id: 'p1',
          sectionId: 'wages',
          description: 'x',
          path: ['w2s', 'w2-gone-0', 'box1Wages'],
          value: 1,
          reason: '',
          status: 'pending',
          createdAt: NOW(),
        },
        {
          id: 'p2',
          sectionId: 'wages',
          description: 'x',
          path: ['__proto__', 'polluted'],
          value: 1,
          reason: '',
          status: 'pending',
          createdAt: NOW(),
        },
        {
          id: 'p3',
          sectionId: 'wages',
          description: 'x',
          path: ['w2s', 'w2-d1-0', 'box1Wages'],
          value: '086000',
          reason: '',
          status: 'pending',
          createdAt: NOW(),
        },
      );
    });
    for (const id of ['p1', 'p2', 'p3'])
      expect(await service.decideProposal(id, true)).toEqual({ ok: false, error: expect.stringContaining('no longer fits') });
    expect(store.get().overrides).toEqual([]);
    expect(store.get().proposals.map((p) => p.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('will not export until every section is approved', async () => {
    const { service } = await setup();
    expect(await service.exportPackage()).toEqual({ ok: false, error: expect.stringContaining('Approve every section') });
  });

  it('applies a checked table of amounts: corrections replace what was read, and every line counts as checked', async () => {
    const { service, store } = await setup();
    await store.update((d) => {
      d.documents.push(
        doc('d1', [w2Extraction()], { fieldChecks: { '0:stateLines.0.stateTax': 'mismatch', '0:stateLines.0.stateWages': 'unverified' } }),
      );
      reconcile(d);
    });
    const id = 'confirm-group:d1:0:stateLines';
    expect(store.get().questions.some((q) => q.id === id)).toBe(true);
    await service.answer(id, JSON.stringify({ 'stateLines.0.stateTax': 4_200_00, nope: 1 })); // a line it didn't ask about
    expect(store.get().documents[0].fieldChecks['0:stateLines.0.stateTax']).toBe('mismatch'); // refused whole
    await service.answer(id, JSON.stringify({ 'stateLines.0.stateTax': 4_200_00, 'stateLines.0.stateWages': 8_500_000 }));
    const doc0 = store.get().documents[0];
    const line = (doc0.extractions[0].data as { stateLines: { stateTax: { amount: string; quote: string | null } }[] }).stateLines[0];
    expect(line.stateTax).toMatchObject({ amount: '4200.00', quote: 'Corrected by you' });
    expect(doc0.fieldChecks).toMatchObject({ '0:stateLines.0.stateTax': 'verified', '0:stateLines.0.stateWages': 'verified' });
    expect(store.get().questions.some((q) => q.id === id)).toBe(false);
  });

  it('keeps an identity answer only when it is usable, in one normal form', async () => {
    const { service, store } = await setup();
    const answerOf = (id: string) => store.get().questions.find((q) => q.id === id)?.answer;
    await service.answer('your-ssn', '12345');
    expect(answerOf('your-ssn')).toBeNull();
    await service.answer('your-ssn', '078-05-1120');
    expect(answerOf('your-ssn')).toBe('078051120');
    await service.answer('your-name', JSON.stringify({ first: 'Pat', last: '' }));
    expect(answerOf('your-name')).toBeNull();
    await service.answer('your-name', JSON.stringify({ first: ' Pat ', last: 'Example' }));
    expect(answerOf('your-name')).toBe(JSON.stringify({ first: 'Pat', last: 'Example' }));
  });

  it('keeps working when working out the return throws: a plain message, steps paused, the error logged once', async () => {
    const { service, store, logs, views } = await setup();
    vi.mocked(buildView).mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'kind')");
    });
    const v = service.view();
    expect(v.problem).toBe(true);
    expect(v.now).toMatchObject({ title: 'Tidy hit a snag', tone: 'fix' });
    expect(v.sections.every((s) => s.status === 'paused')).toBe(true);
    expect(v.canExport).toBe(false);
    await store.update((d) => {
      d.onboarding.welcomed = true;
    });
    await new Promise((r) => setTimeout(r, 80)); // the view goes out 50 ms after a change
    expect(views.at(-1)?.problem).toBe(true);
    expect(await service.approve('profile')).toEqual({ ok: false, error: 'This section isn’t ready to approve yet.' });
    expect(logs).toEqual(["Working out the return: Cannot read properties of undefined (reading 'kind')"]);
  });

  it('says so when the PDF can’t be made, and logs why', async () => {
    const { service, logs } = await setup({
      buildPackage: async () => {
        throw new Error('No field f1_01 on this form');
      },
    });
    vi.mocked(buildView).mockImplementation((s, c) => ({ ...realBuildView(s, c), canExport: true }));
    expect(await service.exportPackage()).toEqual({
      ok: false,
      error: 'Tidy couldn’t make your PDF, so nothing was saved. Try again, and if it keeps happening, quit and reopen Tidy.',
    });
    expect(logs).toEqual(['Making the PDF: No field f1_01 on this form']);
  });

  it('says plainly why chat failed, offers another AI when that helps, and logs the real error', async () => {
    const outOfCredits = Anthropic.APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
        },
      },
      undefined,
      new Headers(),
    );
    const { service, logs } = await setup({
      connect: async (provider) => ({ provider, llm: new FakeLlm(respond), chat: failingChat(outOfCredits) }),
    });
    await service.setApiKey('anthropic', GOOD_KEY);
    await service.sendChat('Hello');
    const { chat } = service.view();
    expect(chat.messages.map((m) => [m.role, m.text, m.error])).toEqual([
      ['user', 'Hello', undefined],
      [
        'assistant',
        'Your Anthropic account is out of credits, so Claude can’t answer. Add credits in the Anthropic Console under Plans & Billing, or switch Tidy to Gemini.',
        { changeAi: true },
      ],
    ]);
    expect(chat.busyId).toBeNull();
    expect(logs).toEqual([expect.stringMatching(/^Chat: 400 .*Your credit balance is too low/)]);
  });

  it('keeps chats apart: starts new ones, resumes old ones with their own transcript, and deletes them', async () => {
    const { service, chats, histories } = await setup();
    await service.setApiKey('gemini', GEMINI_KEY);
    await service.sendChat('First question');
    const first = service.view().chat;
    expect(first.conversations).toEqual([
      { id: first.currentId, title: 'First question', createdAt: NOW(), updatedAt: NOW(), messageCount: 2 },
    ]);
    await service.newChat();
    expect(service.view().chat).toMatchObject({ currentId: null, messages: [] });
    await service.sendChat('Second question');
    const secondId = service.view().chat.currentId;
    expect(secondId).not.toBe(first.currentId);
    expect(histories.map((h) => h.length)).toEqual([1, 1]); // the new chat started its own transcript
    await service.openChat(first.currentId!);
    expect(service.view().chat.messages.map((m) => m.text)).toEqual(['First question', 'Hi']);
    await service.sendChat('Follow-up');
    expect(histories[2]).toHaveLength(3); // the first chat's transcript came back with it
    await service.deleteChat(secondId!);
    await service.deleteChat(first.currentId!);
    expect(service.view().chat).toMatchObject({ currentId: null, messages: [], conversations: [] });
    expect(chats.all()).toEqual([]);
  });

  it('finds saved chats by words', async () => {
    const { service } = await setup();
    await service.setApiKey('gemini', GEMINI_KEY);
    await service.sendChat('How does the SALT cap work?');
    const id = service.view().chat.currentId;
    expect(await service.searchChats({ words: 'salt', from: null, to: null })).toEqual([{ id, snippet: 'How does the SALT cap work?' }]);
    expect(await service.searchChats({ words: 'mortgage', from: null, to: null })).toEqual([]);
  });

  it('moves the chat saved before chat history existed into the list, once', async () => {
    const legacy = {
      messages: [
        { id: 'm1', role: 'user', text: 'What is box 12?', at: '2026-10-12T16:00:00.000Z', proposalIds: [] },
        { id: 'm2', role: 'assistant', text: 'It lists codes.', at: '2026-10-12T16:00:09.000Z', proposalIds: [] },
      ],
      transcript: [{ role: 'user', content: 'What is box 12?' }],
    };
    const { store, chats, deps } = await setup({}, (store) =>
      store.update((d) => {
        Object.assign(d, { chat: legacy }); // where chat lived before
      }),
    );
    expect(chats.all()).toEqual([
      {
        id: 'chat-before-history',
        title: 'What is box 12?',
        createdAt: '2026-10-12T16:00:00.000Z',
        updatedAt: '2026-10-12T16:00:09.000Z',
        messages: legacy.messages,
        transcript: legacy.transcript,
        transcriptBy: 'anthropic', // a transcript without one was always Claude's
      },
    ]);
    expect(chats.currentId()).toBe('chat-before-history');
    expect('chat' in store.get()).toBe(false);
    await new TidyService(deps).init(); // the next start finds nothing left to move
    expect(chats.all()).toHaveLength(1);
  });

  it('backs up the return with a passphrase, and restores it on another Mac', async () => {
    const a = await setup();
    await a.store.update((d) => {
      d.documents.push(doc('d1', [w2Extraction()]));
    });
    await a.store.putDocument('d1', Buffer.from('%PDF-1.7 the W-2'));
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'tidy-backup-')), 'Tidy backup.tidybackup');
    const saved = await new TidyService({ ...a.deps, savePath: async () => file }).exportBackup('a long passphrase');
    expect(saved).toEqual({ ok: true, path: file });
    expect((await readFile(file)).includes(Buffer.from('Alex Rivera'))).toBe(false); // locked, not just zipped

    const b = await setup({ pickBackupFile: async () => file, readFile: (f) => readFile(f) });
    expect(await b.service.restoreBackup('the wrong passphrase')).toEqual({
      ok: false,
      error: 'That passphrase doesn’t open this backup.',
    });
    expect(b.store.get().documents).toEqual([]);
    expect(await b.service.restoreBackup('a long passphrase')).toEqual({ ok: true });
    expect(b.store.get().documents.map((d) => d.id)).toEqual(['d1']);
    expect((await b.store.getDocument('d1')).toString()).toBe('%PDF-1.7 the W-2');
    expect(await a.service.exportBackup('short')).toEqual({ ok: false, error: expect.stringContaining('at least 10 characters') });
  });

  it('refuses a backup whose document ids could escape Tidy’s folder', async () => {
    const { sealWithPassphrase } = await import('../../src/main/vault');
    const a = await setup();
    const evil = { ...a.store.get(), documents: [{ ...doc('x', []), id: '../../escape' }] };
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'tidy-backup-')), 'evil.tidybackup');
    const payload = {
      format: 'tidy-backup',
      version: 1,
      taxYear: 2025,
      exportedAt: 'now',
      state: evil,
      documents: { '../../escape': 'AA==' },
    };
    await writeFile(file, await sealWithPassphrase('a long passphrase', Buffer.from(JSON.stringify(payload))));
    const b = await setup({ pickBackupFile: async () => file, readFile: (f) => readFile(f) });
    expect(await b.service.restoreBackup('a long passphrase')).toEqual({
      ok: false,
      error: expect.stringContaining('nothing was changed'),
    });
    expect(b.store.get().documents).toEqual([]);
  });

  it('converts iPhone photos, and says why a file wasn’t added', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tidy-add-'));
    const heic = path.join(dir, 'IMG_0001.HEIC');
    const docx = path.join(dir, 'notes.docx');
    await writeFile(heic, 'heic bytes');
    await writeFile(docx, 'words');
    const { service, store } = await setup({ heicToJpeg: async () => Buffer.from('jpeg bytes') });
    expect(await service.addPaths([heic, docx, dir])).toEqual({
      added: 1,
      duplicates: 0,
      rejected: [
        'Tidy can’t read notes.docx. It reads PDFs, photos (JPG, PNG or HEIC) and CSV files.',
        `${path.basename(dir)} is a folder. Add the files inside it instead.`,
      ],
    });
    expect(store.get().documents.map((d) => [d.fileName, d.mimeType])).toEqual([['IMG_0001.jpg', 'image/jpeg']]);
  });
});
