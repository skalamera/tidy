import { describe, expect, it } from 'vitest';
import { deriveFacts } from '../../src/core/deriveFacts';
import { reconcileQuestions } from '../../src/core/reconcile';
import { sameIssuer, expectedFromPriorYear, expectedNow } from '../../src/core/expected';
import { applyOverrides } from '../../src/core/overrides';
import { doc, priorYear, stateWith, w2Extraction, NOW } from '../fixtures/state';

describe('deriveFacts', () => {
  it('builds facts from last year’s return and a W-2', () => {
    const s = stateWith({
      documents: [doc('py', [priorYear()]), doc('d1', [w2Extraction({ employeeName: 'Sam Rivera', employeeSsnLast4: '0002' })])],
    });
    const f = deriveFacts(s);
    expect(f.filingStatus).toBe('mfj');
    expect(f.residency.state).toBe('MD');
    expect(f.payments.federalPriorYearApplied).toBe(500_000);
    expect(f.w2s).toHaveLength(1);
    expect(f.w2s[0].id).toBe('w2-d1-0');
    expect(f.w2s[0].owner).toBe('spouse');
    expect(f.w2s[0].box6MedicareWithheld).toBe(123_250);
  });

  it('keeps only the digits of SSNs the 2024 return prints with dashes or spaces, so the forms can hold them', () => {
    const s = stateWith({
      documents: [
        doc('py', [
          priorYear({
            taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400-00-0001' },
            spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400 00 0002' },
          }),
        ]),
      ],
    });
    const f = deriveFacts(s);
    expect(f.taxpayer.ssn).toBe('400000001');
    expect(f.spouse?.ssn).toBe('400000002');
  });

  it('skips superseded (corrected) documents', () => {
    const s = stateWith({ documents: [doc('old', [w2Extraction()], { supersededBy: 'new' }), doc('new', [w2Extraction()])] });
    expect(deriveFacts(s).w2s.map((w) => w.id)).toEqual(['w2-new-0']);
  });

  it('applies answers, then overrides last', () => {
    const s = stateWith({
      documents: [doc('py', [priorYear()]), doc('d1', [w2Extraction()])],
      questions: [
        {
          id: 'state-balance-paid',
          sectionId: 'deductions',
          kind: 'yes_no',
          prompt: '',
          help: null,
          choices: null,
          suggested: null,
          blocking: true,
          origin: 'rule',
          answer: 'yes',
          answeredAt: NOW,
        },
      ],
      overrides: [
        { id: 'o1', path: ['w2s', 'w2-d1-0', 'box1Wages'], value: 8_600_000, reason: 'typo on scan', createdAt: NOW, createdBy: 'user' },
      ],
    });
    const f = deriveFacts(s);
    expect(f.itemized.stateIncomeTaxPayments).toEqual([{ label: '2024 state balance paid in 2025', amount: 320_000 }]);
    expect(f.w2s[0].box1Wages).toBe(8_600_000);
  });
});

describe('applyOverrides', () => {
  it('sets aside a path that no longer exists instead of throwing (see overrides.test.ts)', () => {
    const stale = { id: 'x', path: ['w2s', 'gone', 'box1Wages'], value: 1, reason: '', createdAt: NOW, createdBy: 'user' as const };
    expect(applyOverrides({ w2s: [] as { id: string }[] }, [stale])).toEqual({ facts: { w2s: [] }, skipped: [stale] });
  });
});

describe('expected documents', () => {
  it('expects only the payers on the 2024 return, keeps each “Not this year”, and drops them when that return goes', () => {
    const py = doc('py', [priorYear()]);
    const s = stateWith({
      documents: [py],
      expected: [
        { key: 'w2:acme', name: 'Acme Corp', form: 'w2', dismissed: true },
        { key: 'f1099_int:old-bank', name: 'Old Bank', form: 'f1099_int', dismissed: true }, // left by a removed return
      ],
    });
    expect(expectedNow(s)).toEqual([
      { key: 'w2:acme', name: 'Acme Corp', form: 'w2', dismissed: true },
      { key: 'f1099_div:charles-schwab', name: 'Charles Schwab & Co., Inc.', form: 'f1099_div', dismissed: false },
    ]);
    expect(expectedNow({ ...s, documents: [] })).toEqual([]);
    expect(expectedNow({ ...s, documents: [doc('py23', [priorYear({ taxYear: 2023 })])] })).toEqual([]);
    const stillReading = { ...s, documents: [py, doc('d2', [], { status: 'reading' })] };
    expect(expectedNow(stillReading)).toBe(stillReading.expected); // a file being read might be last year's: wait for it
  });

  it('matches payer names loosely', () => {
    expect(sameIssuer('Charles Schwab & Co., Inc.', 'CHARLES SCHWAB')).toBe(true);
    expect(sameIssuer('Fidelity Investments', 'Vanguard')).toBe(false);
  });
  it('dedupes payers from last year', () => {
    const py = priorYear().data as Parameters<typeof expectedFromPriorYear>[0];
    expect(expectedFromPriorYear(py).map((e) => e.key)).toEqual(['w2:acme', 'f1099_div:charles-schwab']);
  });
});

describe('reconcileQuestions', () => {
  it('asks the right profile questions and follows up on “no”', () => {
    const base = stateWith({ documents: [doc('py', [priorYear()])] });
    const q1 = reconcileQuestions(base);
    expect(q1.map((q) => q.id)).toContain('filing-status-same');
    expect(q1.map((q) => q.id)).not.toContain('filing-status');
    const answered = q1.map((q) => (q.id === 'filing-status-same' ? { ...q, answer: 'no', answeredAt: NOW } : q));
    const q2 = reconcileQuestions({ ...base, questions: answered });
    expect(q2.map((q) => q.id)).toContain('filing-status');
  });

  it('asks to confirm amounts it could not verify', () => {
    const d = doc('d1', [w2Extraction()], { fieldChecks: { '0:box1Wages': 'unverified', '0:box2FedWithheld': 'verified' } });
    const qs = reconcileQuestions(stateWith({ documents: [d] }));
    const c = qs.find((q) => q.id === 'confirm:d1:0:box1Wages');
    expect(c?.kind).toBe('confirm_amount');
    expect(c?.suggested).toBe(8_500_000);
    expect(qs.some((q) => q.id === 'confirm:d1:0:box2FedWithheld')).toBe(false);
  });

  it('lists missing expected documents until received or dismissed', () => {
    const s = stateWith({ expected: [{ key: 'w2:acme', name: 'Acme Corp', form: 'w2', dismissed: false }] });
    expect(reconcileQuestions(s).some((q) => q.id === 'expected:w2:acme')).toBe(true);
    const received = {
      ...s,
      documents: [
        doc('d1', [w2Extraction()], {
          docType: 'w2',
          classification: {
            docType: 'w2',
            taxYear: 2025,
            issuerName: 'ACME CORP',
            recipientName: null,
            isCorrected: false,
            confidence: 'high',
            parts: [],
          },
        }),
      ],
    };
    expect(reconcileQuestions(received).some((q) => q.id === 'expected:w2:acme')).toBe(false);
  });
});
