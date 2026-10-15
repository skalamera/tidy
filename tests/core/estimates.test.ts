import { describe, expect, it } from 'vitest';
import { suggestedWindows, windowOf } from '../../src/core/estimates';
import { deriveFacts } from '../../src/core/deriveFacts';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMaryland } from '../../src/engine/md/form502';
import { usd } from '../../src/engine/money';
import type { TaxFacts } from '../../src/shared/facts';
import type { Extraction } from '../../src/shared/state';
import { facts, w2 } from '../fixtures/facts';
import { amt, answered, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const record = (
  datePaid: string | null,
  amount: string,
  kind: 'federal_estimate' | 'state_estimate' = 'federal_estimate',
  forTaxYear: number | null = 2025,
): Extraction => ({
  form: 'payment',
  firstPage: 1,
  data: {
    kind,
    payee: kind === 'federal_estimate' ? 'IRS' : 'Comptroller of Maryland',
    datePaid,
    forTaxYear,
    amount: amt(amount),
    state: kind === 'state_estimate' ? 'MD' : null,
  },
});

describe('estimated payment windows', () => {
  it('puts each payment in the window that ends with the installment it counts toward', () => {
    expect(
      ['2025-04-15', '2025-04-16', '2025-06-16', '2025-06-17', '2025-09-15', '2025-12-31', '2026-01-15', '2026-01-16'].map((d) =>
        windowOf(d, false),
      ),
    ).toEqual(['q1', 'q2', 'q2', 'q3', 'q3', 'q4', 'q4', 'late']);
    expect(['2025-12-31', '2026-01-02'].map((d) => windowOf(d, true))).toEqual(['q4a', 'q4b']);
  });

  it('uses the payment records to fill in the question, never to hide it', () => {
    const s = answered(
      stateWith({
        documents: [
          doc('py', [priorYear()]),
          doc('d1', [w2Extraction()]),
          doc('p1', [record('2025-04-10', '1,000.00'), record('2025-09-12', '1,500.00'), record(null, '500.00')]),
        ],
      }),
      {},
    );
    const q = s.questions.find((x) => x.id === 'federal-estimates')!;
    expect(q).toMatchObject({ kind: 'lines', suggestedLines: { q1: 100_000, q3: 150_000 } });
    expect(q.help).toBe(
      'Filled in from 3 payment records you uploaded. Check them against your online account and add any payment that’s missing. One record has no date, so add it yourself.',
    );
    expect(deriveFacts(s).payments.federalEstimated).toEqual([]); // nothing counts until the user answers
    const f = deriveFacts(answered(s, { 'federal-estimates': JSON.stringify({ q1: 100_000, q2: 50_000, q3: 150_000 }) }));
    expect(f.payments.federalEstimated).toEqual([100_000, 50_000, 150_000]);
    expect(f.payments.federalEstimatedByQuarter).toEqual([100_000, 50_000, 150_000, 0]);
  });

  it('treats a January 2025 state payment as last year’s, for the deduction only', () => {
    const s = stateWith({ documents: [doc('py', [priorYear()]), doc('p1', [record('2025-01-14', '800.00', 'state_estimate', null)])] });
    expect(suggestedWindows(s, 'state_estimate', 'MD').records).toBe(0);
    const q = answered(s, { 'resident-state': 'MD' }).questions.find((x) => x.id === 'state-estimate-prior-january');
    expect(q?.suggested).toBe(80_000);
  });
});

describe('the penalty uses when payments were made', () => {
  const underpaid = (p: Partial<TaxFacts['payments']>): TaxFacts =>
    facts({
      w2s: [w2({ box1Wages: usd(250_000), box2FedWithheld: 0 })],
      payments: {
        federalEstimated: [usd(16_000)],
        federalPriorYearApplied: 0,
        federalExtensionPayment: 0,
        priorYearFederalAgi: usd(100_000),
        priorYearFederalTax: usd(16_000),
        computeForm2210: true,
        ...p,
      },
    });

  it('credits a payment only toward installments due on or after it, and a late one toward none', () => {
    const onTime = computeFederal(underpaid({ federalEstimatedByQuarter: [usd(4_000), usd(4_000), usd(4_000), usd(4_000)] }));
    expect(onTime.ledger.get('f2210.19')).toBe(0);
    const allInJanuary = computeFederal(underpaid({ federalEstimatedByQuarter: [0, 0, 0, usd(16_000)] }));
    const late = computeFederal(underpaid({ federalEstimatedByQuarter: [0, 0, 0, 0] }));
    expect(allInJanuary.ledger.get('f2210.17.a')).toBe(usd(4_000));
    expect(allInJanuary.ledger.get('f2210.19')).toBeGreaterThan(0);
    expect(late.ledger.get('f2210.19')).toBeGreaterThan(allInJanuary.ledger.get('f2210.19'));
    expect(late.totalPayments).toBe(allInJanuary.totalPayments); // a late payment still pays the balance
  });

  it('Maryland Form 502UP uses the payments by quarter too', () => {
    const md = (byQ: [number, number, number, number]) => {
      const f = facts({
        w2s: [w2({ box1Wages: usd(220_000), stateLines: [{ state: 'MD', stateWages: usd(220_000), stateTax: usd(2_000) }] })],
        stateReturn: {
          homeStateMuniInterest: null,
          estimatedPayments: byQ.filter((x) => x > 0),
          estimatedByQuarter: byQ,
          priorYearApplied: 0,
          extensionPayment: 0,
          priorYearMdTax: usd(10_000),
          computeForm502UP: true,
        },
      });
      return computeMaryland(f, computeFederal(f)).ledger.get('md502up.18');
    };
    const even = md([usd(2_250), usd(2_250), usd(2_250), usd(2_250)]);
    const lateInYear = md([0, 0, 0, usd(9_000)]);
    expect(lateInYear).toBeGreaterThan(even);
  });
});
