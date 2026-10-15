import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { facts, w2 } from '../fixtures/facts';

// All the estimated tax arrives in January 2026: an overpayment overall, but the first three installments were late.
const lateButOverpaid = (p: { applyFederal?: 'all' | number; applyMd?: 'all' | number } = {}) =>
  facts({
    w2s: [w2({ box1Wages: usd(300_000), box2FedWithheld: 0, stateLines: [{ state: 'MD', stateWages: usd(300_000), stateTax: 0 }] })],
    payments: {
      federalEstimated: [usd(120_000)],
      federalEstimatedDated: [{ datePaid: '2026-01-10', amount: usd(120_000) }],
      federalPriorYearApplied: 0,
      federalExtensionPayment: 0,
      priorYearFederalAgi: usd(250_000),
      priorYearFederalTax: usd(60_000),
      computeForm2210: true,
      ...(p.applyFederal !== undefined ? { applyToNextYear: p.applyFederal } : {}),
    },
    stateReturn: {
      homeStateMuniInterest: 0,
      estimatedPayments: [0, 0, 0, usd(40_000)],
      priorYearApplied: 0,
      extensionPayment: 0,
      priorYearMdTax: usd(15_000),
      computeForm502UP: true,
      ...(p.applyMd !== undefined ? { applyToNextYear: p.applyMd } : {}),
    },
  });

describe('refund and underpayment penalty together (2025 Form 1040 line 38; MD 2025 booklet, Overpayment)', () => {
  it('takes the federal penalty out of the overpayment instead of owing and refunding at once', () => {
    const r = computeFederal(lateButOverpaid());
    const L34 = r.ledger.get('f1040.34');
    const L38 = r.ledger.get('f1040.38');
    expect(L34).toBeGreaterThan(0);
    expect(L38).toBeGreaterThan(0);
    expect(r.ledger.get('f1040.35a')).toBe(L34 - L38);
    expect(r.ledger.get('f1040.37')).toBe(0);
    expect(r.amountOwed).toBe(0);
    expect(r.refund).toBe(L34 - L38);
    expect(r.forms).not.toContain('f1040v');
  });

  it('applies part of the overpayment to next year on line 36, so 35a + 36 + 38 = 34', () => {
    const r = computeFederal(lateButOverpaid({ applyFederal: usd(5_000) }));
    const [L34, L35a, L36, L38] = ['f1040.34', 'f1040.35a', 'f1040.36', 'f1040.38'].map((id) => r.ledger.get(id));
    expect(L36).toBe(usd(5_000));
    expect(L35a! + L36! + L38!).toBe(L34);
    const all = computeFederal(lateButOverpaid({ applyFederal: 'all' }));
    expect(all.refund).toBe(0);
    expect(all.appliedToNextYear).toBe(all.ledger.get('f1040.34') - all.ledger.get('f1040.38'));
  });

  it('owes only the excess when the penalty is larger than the overpayment', () => {
    const f = lateButOverpaid();
    const base = computeFederal(f);
    const taxPlusSmallOverpay = base.ledger.get('f1040.24') + usd(10);
    const tiny = computeFederal({
      ...f,
      payments: {
        ...f.payments,
        federalEstimated: [taxPlusSmallOverpay],
        federalEstimatedDated: [{ datePaid: '2026-01-10', amount: taxPlusSmallOverpay }],
      },
    });
    expect(tiny.ledger.get('f1040.34')).toBe(usd(10));
    expect(tiny.ledger.get('f1040.35a')).toBe(0);
    expect(tiny.ledger.get('f1040.37')).toBe(tiny.ledger.get('f1040.38') - usd(10));
    expect(tiny.forms).toContain('f1040v');
  });

  it('takes Maryland interest out of the overpayment (line 50 = 48 − 49 − 51)', () => {
    const f = lateButOverpaid({ applyMd: usd(1_000) });
    const md = computeMd(f, computeFederal(f));
    const [L48, L49, L50, L51, L52] = ['md502.48', 'md502.49', 'md502.50', 'md502.51', 'md502.52'].map((id) => md.ledger.get(id));
    expect(L48).toBeGreaterThan(0);
    expect(L51).toBeGreaterThan(0);
    expect(L49).toBe(usd(1_000));
    expect(L50).toBe(L48! - L49! - L51!);
    expect(L52).toBe(0);
    expect(md.amountOwed).toBe(0);
    expect(md.forms).not.toContain('mdpv');
  });
});
