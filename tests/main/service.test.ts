import { describe, expect, it } from 'vitest';
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
import { ReturnStore } from '../../src/main/store';
import type { AiProvider } from '../../src/shared/ai';
import { w2Extraction } from '../fixtures/state';

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

async function setup(overrides: Partial<ServiceDeps> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tidy-service-'));
  const store = await ReturnStore.open(path.join(dir, 'store'), randomBytes(32), NOW);
  const lawFile = path.join(dir, 'chunks.json');
  await writeFile(lawFile, '[]');
  let n = 0;
  const saved: string[] = [];
  const emitted: string[] = [];
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
    aiKeys: { load: async () => null, save: async (provider, key) => void saved.push(`${provider}:${key}`) },
    pdf,
    law: await LawSearch.load(lawFile),
    connect: async (provider, key) => {
      if (key !== ACCEPTED[provider]) throw new Error('401');
      return { provider, llm: new FakeLlm(respond), chat };
    },
    now: NOW,
    newId: () => `id${++n}`,
    emit: (channel) => void emitted.push(channel),
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
  return { service, store, saved, emitted, w2File, histories };
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
    const { service, store, saved, histories } = await setup();
    await store.update((d) => {
      d.chat.transcript = [{ role: 'user', content: 'asked Claude earlier' }]; // no transcriptBy: written before Gemini support
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
    expect(store.get().chat.transcriptBy).toBe('gemini');
    await service.sendChat('And now?');
    expect(histories[1]).toHaveLength(3); // Gemini's own transcript does come back
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
});
