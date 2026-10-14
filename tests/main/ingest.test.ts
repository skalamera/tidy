import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ReturnStore } from '../../src/main/store';
import { FakeLlm } from '../../src/main/ai/llm';
import { CLASSIFY_SYSTEM } from '../../src/main/ai/prompts';
import { addFile, processDocument, type PdfTools } from '../../src/main/pipeline/ingest';
import { deriveFacts } from '../../src/core/deriveFacts';
import { priorYear, r1099Extraction, ssa1099Extraction, w2Extraction } from '../fixtures/state';

const NOW = () => '2026-10-13T12:00:00.000Z';
let n = 0;
const newId = () => `doc${++n}`;

const pdf = (pages: string[] | null): PdfTools => ({
  pageCount: async () => pages?.length ?? 1,
  pageTexts: async () => pages,
  slicePages: async (b) => b,
});

function classification(docType: string, issuerName: string, parts: { form: string; firstPage: number; lastPage: number }[] = []) {
  return { docType, taxYear: 2025, issuerName, recipientName: 'Alex Rivera', isCorrected: false, confidence: 'high', parts };
}

async function setup(pages: string[] | null, respond: ConstructorParameters<typeof FakeLlm>[0]) {
  const store = await ReturnStore.open(await mkdtemp(path.join(tmpdir(), 'tidy-ingest-')), randomBytes(32), NOW);
  const llm = new FakeLlm(respond);
  return { store, llm, deps: { store, llm, provider: 'gemini' as const, pdf: pdf(pages), now: NOW, newId } };
}

describe('ingest pipeline', () => {
  it('expects nothing from a return for another year', async () => {
    const { store, deps } = await setup(['Form 1040 2023 ... 430,000 ... 5,000'], (call) =>
      call.system === CLASSIFY_SYSTEM ? classification('prior_year_federal_return', 'IRS') : priorYear({ taxYear: 2023 }).data,
    );
    const { id } = await addFile(deps, '2023 return.pdf', Buffer.from('%PDF 2023 return'));
    await processDocument(deps, id);
    expect(store.get().documents[0].status).toBe('done');
    expect(store.get().expected).toEqual([]);
  });

  it('says what the AI service said when it can’t read a file', async () => {
    const quota = new ApiError({
      status: 429,
      message: JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED' } }),
    });
    const { store, deps } = await setup(['Form W-2 2025'], () => {
      throw quota;
    });
    const { id } = await addFile(deps, 'w2.pdf', Buffer.from('%PDF w2'));
    await processDocument(deps, id);
    expect(store.get().documents[0]).toMatchObject({
      status: 'failed',
      error:
        'Your Gemini key has hit its usage limit, so Gemini can’t read this file right now. Wait a minute and try again. If it keeps happening, check its plan and billing in Google AI Studio, or switch Tidy to Claude.',
    });
  });

  it('reads last year’s return, seeds expected documents and profile questions', async () => {
    const { store, deps } = await setup(['Form 1040 2024 ... 430,000 ... 5,000'], (call) =>
      call.system === CLASSIFY_SYSTEM ? classification('prior_year_federal_return', 'IRS') : priorYear().data,
    );
    const { id } = await addFile(deps, '2024 return.pdf', Buffer.from('%PDF prior'));
    await processDocument(deps, id);
    const s = store.get();
    expect(s.documents[0].status).toBe('done');
    expect(s.expected.map((e) => e.key)).toEqual(['w2:acme', 'f1099_div:charles-schwab']);
    expect(s.questions.map((q) => q.id)).toContain('filing-status-same');
    expect(s.questions.map((q) => q.id)).toContain('expected:w2:acme');
    expect(deriveFacts(s).filingStatus).toBe('mfj');
  });

  it('extracts a W-2, verifies amounts against the page, and asks about the one it could not verify', async () => {
    const page = 'Wages 85,000.00 Federal 11,000.00 SS wages 85,000.00 SS tax 5,270.00 Medicare 85,000.00 1,232.50 MD 85,000.00';
    const { store, deps } = await setup([page], (call) =>
      call.system === CLASSIFY_SYSTEM ? classification('w2', 'Acme Corp') : w2Extraction().data,
    );
    const { id } = await addFile(deps, 'w2.pdf', Buffer.from('%PDF w2'));
    await processDocument(deps, id);
    const d = store.get().documents[0];
    expect(d.fieldChecks['0:box1Wages']).toBe('verified');
    expect(d.fieldChecks['0:stateLines.0.stateTax']).toBe('mismatch'); // 4,100.00 is not on the page
    expect(deriveFacts(store.get()).w2s[0].box1Wages).toBe(8_500_000);
  });

  it('dedupes the same file and marks unsupported documents', async () => {
    const { store, deps } = await setup(['K-1'], (call) =>
      call.system === CLASSIFY_SYSTEM ? classification('k1_1065', 'Blackstone') : {},
    );
    const a = await addFile(deps, 'k1.pdf', Buffer.from('%PDF k1'));
    const b = await addFile(deps, 'k1 copy.pdf', Buffer.from('%PDF k1'));
    expect(b).toEqual({ id: a.id, duplicate: true });
    await processDocument(deps, a.id);
    expect(store.get().documents[0].status).toBe('unsupported');
  });

  it('extracts a 1099-R and an SSA-1099 and verifies their amounts', async () => {
    const rPage = 'Gross distribution 35,000.00 Taxable amount 35,000.00 Federal income tax withheld 3,500.00 MD tax 1,500.00 35,000.00';
    const { store, deps } = await setup([rPage], (call) => {
      if (call.system === CLASSIFY_SYSTEM) {
        return call.prompt.includes('ssa') ? classification('ssa_1099', 'SSA') : classification('f1099_r', 'State Retirement System');
      }
      return call.prompt.includes('SSA-1099') ? ssa1099Extraction().data : r1099Extraction().data;
    });
    const r = await addFile(deps, '1099r.pdf', Buffer.from('%PDF 1099r'));
    await processDocument(deps, r.id);
    const ssa = await addFile(deps, 'ssa.pdf', Buffer.from('%PDF ssa'));
    await processDocument(deps, ssa.id);

    const f = deriveFacts(store.get());
    expect(f.f1099R).toHaveLength(1);
    expect(f.f1099R![0].box1GrossDistribution).toBe(3_500_000);
    expect(f.ssa1099).toHaveLength(1);
    expect(f.ssa1099![0].box5NetBenefits).toBe(2_000_000);
  });

  it('records a friendly error instead of crashing', async () => {
    const { store, deps } = await setup(['x'], () => {
      throw new Error('socket hang up');
    });
    const { id } = await addFile(deps, 'x.pdf', Buffer.from('%PDF x'));
    await processDocument(deps, id);
    expect(store.get().documents[0].status).toBe('failed');
    expect(store.get().documents[0].error).toContain('Something went wrong');
  });
});
