import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
import type { AiProvider } from '../../src/shared/ai';
import { IPC } from '../../src/shared/ipc';
import { w2Extraction } from '../fixtures/state';

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

  it('reconnects to the saved AI at startup', async () => {
    const { service } = await setup({ aiKeys: { load: async () => ({ provider: 'gemini', key: GEMINI_KEY }), save: async () => {} } });
    expect(service.view().aiProvider).toBe('gemini');
  });

  it('applies an accepted chat proposal as an override and refuses to apply it twice', async () => {
    const { service, store } = await setup();
    await store.update((d) => {
      d.proposals.push({
        id: 'p1',
        sectionId: 'profile',
        description: 'Answer “No” to the digital assets question',
        path: ['digitalAssets'],
        value: false,
        reason: 'You said so in chat',
        status: 'pending',
        createdAt: NOW(),
      });
    });
    expect(await service.decideProposal('p1', true)).toEqual({ ok: true });
    expect(store.get().overrides).toMatchObject([{ path: ['digitalAssets'], value: false, createdBy: 'ai_proposal' }]);
    expect(await service.decideProposal('p1', true)).toEqual({ ok: false, error: expect.any(String) });
  });

  it('will not export until every section is approved', async () => {
    const { service } = await setup();
    expect(await service.exportPackage()).toEqual({ ok: false, error: expect.stringContaining('Approve every section') });
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
});
