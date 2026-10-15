import { describe, expect, it } from 'vitest';
import { deriveFacts } from '../../src/core/deriveFacts';
import { buildView } from '../../src/core/view';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { usd } from '../../src/engine/money';
import type { F1099GExtractionT } from '../../src/shared/schemas/extraction';
import type { AppState, Extraction } from '../../src/shared/state';
import { amt, answered, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const g1099 = (p: Partial<F1099GExtractionT> = {}): Extraction => ({
  form: 'f1099_g',
  firstPage: 1,
  data: {
    payerName: 'Comptroller of Maryland',
    recipientName: 'Alex Rivera',
    recipientSsnLast4: null,
    box1Unemployment: amt(null),
    box2StateRefund: amt('3,000.00'),
    box3TaxYear: 2024,
    box4FedWithheld: amt(null),
    stateLines: [],
    ...p,
  },
});
const ids = (s: AppState) => s.questions.map((q) => q.id);
const flagIds = (s: AppState) => buildView(s, { aiProvider: null }).flags.map((f) => f.id);
const itemized2024 = {
  itemized: { salesTaxElected: false, line5d: amt('12,000.00'), line5e: amt('10,000.00'), line17: amt('35,000.00') },
  ageOrBlindBoxes: 2,
};

describe('a 2024 state refund', () => {
  it('is taxable only as far as it lowered the 2024 deduction (State and Local Income Tax Refund Worksheet)', () => {
    const s = answered(stateWith({ documents: [doc('py', [priorYear(itemized2024)]), doc('g', [g1099()])] }), {});
    expect(ids(s)).not.toContain('state-refund'); // the 1099-G says
    const f = deriveFacts(s);
    const r = computeFederal(f);
    // Line 1 $3,000; line 2 = 5d − 5e = $2,000; line 3 = $1,000. Line 8 = $35,000 − ($29,200 + 2 × $1,550) = $2,700.
    expect(r.ledger.get('srw.3')).toBe(usd(1_000));
    expect(r.ledger.get('srw.8')).toBe(usd(2_700));
    expect(r.ledger.get('sch1.1')).toBe(usd(1_000));
    expect(r.ledger.get('f1040.8')).toBe(usd(1_000));
    expect(computeMd(f, r).ledger.get('md502.8')).toBe(usd(1_000)); // Maryland subtracts it back out
  });

  it('isn’t taxable when the 2024 return took the standard deduction, and isn’t asked about', () => {
    const s = answered(stateWith({ documents: [doc('py', [priorYear({ itemized: null })]), doc('g', [g1099()])] }), {});
    expect(ids(s)).not.toContain('state-refund');
    expect(computeFederal(deriveFacts(s)).ledger.get('sch1.1')).toBe(0);
  });

  it('comes from the 2024 state return when there’s no 1099-G', () => {
    const s = answered(
      stateWith({
        documents: [
          doc('py', [
            priorYear({
              ...itemized2024,
              stateTotalTax: amt('9,000.00'),
              stateRefund: amt('500.00'),
              stateAppliedToNextYear: amt('700.00'),
            }),
          ]),
        ],
      }),
      {},
    );
    expect(ids(s)).not.toContain('state-refund');
    expect(deriveFacts(s).stateRefund?.refund).toBe(usd(1_200));
  });

  it('is asked about without a 2024 return, and blocks when you itemized in 2024', () => {
    const s0 = answered(stateWith({ documents: [doc('w', [w2Extraction()])] }), {
      'state-refund': 'yes',
      'state-refund-amount': String(usd(800)),
    });
    expect(ids(s0)).toContain('prior-itemized');
    expect(flagIds(answered(s0, { 'prior-itemized': 'yes' }))).toContain('state-refund-needs-2024');
    const no = answered(s0, { 'prior-itemized': 'no' });
    expect(flagIds(no)).not.toContain('state-refund-needs-2024');
    expect(computeFederal(deriveFacts(no)).ledger.get('sch1.1')).toBe(0);
  });

  it('blocks when the worksheet doesn’t apply', () => {
    const otherYear = answered(
      stateWith({ documents: [doc('py', [priorYear(itemized2024)]), doc('g', [g1099({ box3TaxYear: 2023 })])] }),
      {},
    );
    expect(flagIds(otherYear).some((id) => id.startsWith('state-refund-year:'))).toBe(true);
    const amtPaid = answered(
      stateWith({ documents: [doc('py', [priorYear({ ...itemized2024, amt: amt('1,500.00') })]), doc('g', [g1099()])] }),
      {},
    );
    expect(flagIds(amtPaid)).toContain('state-refund-pub525');
  });
});

describe('unemployment on a 1099-G', () => {
  it('goes on Schedule 1 line 7, with its withholding', () => {
    const s = answered(
      stateWith({
        documents: [
          doc('py', [priorYear({ itemized: null })]),
          doc('g', [
            g1099({
              box1Unemployment: amt('6,500.00'),
              box2StateRefund: amt(null),
              box3TaxYear: null,
              box4FedWithheld: amt('650.00'),
              stateLines: [{ state: 'MD', stateTax: amt('300.00') }],
            }),
          ]),
        ],
      }),
      {},
    );
    const f = deriveFacts(s);
    const r = computeFederal(f);
    expect(r.ledger.get('sch1.7')).toBe(usd(6_500));
    expect(r.ledger.get('sch1.10')).toBe(usd(6_500));
    expect(r.ledger.get('f1040.25b')).toBe(usd(650));
    expect(r.forms).toContain('sch1');
    expect(computeMd(f, r).ledger.get('md502.41')).toBe(usd(300));
  });
});
