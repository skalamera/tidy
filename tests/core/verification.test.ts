import { describe, expect, it } from 'vitest';
import { confirmQuestions, GROUP_LIMIT, reconcileQuestions } from '../../src/core/reconcile';
import { buildView } from '../../src/core/view';
import { checkAllAmounts, checkAmount } from '../../src/main/pipeline/verify';
import type { DocumentRecord, Extraction } from '../../src/shared/state';
import { amt, b1099Extraction, doc, stateWith, w2Extraction } from '../fixtures/state';

const page = 'Form W-2 Wage and Tax Statement 2025 Acme Corp 85,000.00 11,000.00 85,000.00 5,270.00 1,232.50 MD 4,100.00';

describe('checking amounts against the page', () => {
  it('asks about a blank box every such form fills in, instead of counting it as 0', () => {
    expect(checkAmount({ amount: null, page: null, quote: null }, [page], true)).toBe('missing');
    expect(checkAmount({ amount: null, page: null, quote: null }, [page])).toBe('verified');
    const checks = checkAllAmounts(w2Extraction({ box1Wages: amt(null), box2FedWithheld: amt(null) }).data, [page], 'w2');
    expect(checks.box1Wages).toBe('missing'); // every W-2 has wages
    expect(checks.box2FedWithheld).toBe('verified'); // no withholding is normal
  });

  it('asks for a sale’s blank cost basis', () => {
    const b = b1099Extraction();
    const data = b.data as { lots: { costBasis: unknown }[] };
    data.lots[0].costBasis = amt(null);
    const checks = checkAllAmounts(b.data, ['x'.repeat(40)], 'f1099_b');
    expect(checks['lots.0.costBasis']).toBe('missing');
  });

  it('checks a CSV download against its own text', () => {
    const csv = 'Description,Proceeds,Cost\n100 sh Example Co,"$12,500.00",9000.00\n';
    expect(checkAmount({ amount: '12,500.00', page: null, quote: null }, [csv])).toBe('verified');
    expect(checkAmount({ amount: '9,000.00', page: 1, quote: null }, [csv])).toBe('verified');
    expect(checkAmount({ amount: '9,100.00', page: null, quote: null }, [csv])).toBe('mismatch');
  });
});

describe('questions for amounts Tidy couldn’t check', () => {
  const w2 = (checks: DocumentRecord['fieldChecks'], x: Extraction = w2Extraction()) =>
    doc('d1', [x], {
      classification: {
        docType: 'w2',
        taxYear: 2025,
        issuerName: 'Acme Corp',
        recipientName: 'Alex Rivera',
        isCorrected: false,
        confidence: 'high',
        parts: [],
      },
      fieldChecks: checks,
    });

  it('asks whether a missing box is blank', () => {
    const [q] = confirmQuestions(w2({ '0:box1Wages': 'missing' }, w2Extraction({ box1Wages: amt(null) })));
    expect(q).toMatchObject({
      id: 'confirm:d1:0:box1Wages',
      kind: 'confirm_amount',
      suggested: null,
      prompt: 'We didn’t find box 1 (wages) on the Acme Corp W-2. Is it blank?',
    });
  });

  it('groups a table’s amounts (state lines, sales) into one question to check at once', () => {
    const qs = confirmQuestions(
      w2({ '0:stateLines.0.stateTax': 'mismatch', '0:stateLines.0.stateWages': 'unverified', '0:box1Wages': 'verified' }),
    );
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({
      id: 'confirm-group:d1:0:stateLines',
      kind: 'lines',
      sectionId: 'wages',
      prompt: 'Check these 2 amounts on the Acme Corp W-2',
      choices: [
        { value: 'stateLines.0.stateTax', label: 'MD: state tax' },
        { value: 'stateLines.0.stateWages', label: 'MD: state wages' },
      ],
      suggestedLines: { 'stateLines.0.stateTax': 410_000, 'stateLines.0.stateWages': 8_500_000 },
    });
    expect(qs[0].help).toContain('don’t match the text on the page');
  });

  it('blocks a table too long to check by hand instead of asking hundreds of lines', () => {
    const b = b1099Extraction();
    const lots = (b.data as { lots: unknown[] }).lots;
    const many = Array.from({ length: GROUP_LIMIT + 1 }, () => structuredClone(lots[0]));
    (b.data as { lots: unknown[] }).lots = many;
    const checks = Object.fromEntries(many.map((_, i) => [`0:lots.${i}.proceeds`, 'unverified' as const]));
    const big = doc('b1', [b], { fieldChecks: checks });
    expect(confirmQuestions(big)).toEqual([]);
    const v = buildView(stateWith({ documents: [big] }), { aiProvider: null });
    expect(v.flags.find((f) => f.id === 'too-many-checks:b1')).toMatchObject({ severity: 'blocker' });
  });

  it('a document that couldn’t be read blocks the return', () => {
    const v = buildView(stateWith({ documents: [doc('f1', [], { status: 'failed', error: 'The file was damaged.' })] }), {
      aiProvider: null,
    });
    expect(v.flags.find((f) => f.id === 'failed:f1')).toMatchObject({ severity: 'blocker' });
    expect(v.canExport).toBe(false);
  });

  it('keeps the group in the question list', () => {
    const s = stateWith({ documents: [w2({ '0:stateLines.0.stateTax': 'unverified' })] });
    expect(reconcileQuestions(s).map((q) => q.id)).toContain('confirm-group:d1:0:stateLines');
  });
});
