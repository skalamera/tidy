import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd } from '../../src/engine/money';
import { S1, S3, facts, int1099, w2 } from '../fixtures/facts';

describe('AMT screen (Form 6251 upper bound)', () => {
  it('rules out AMT for ordinary wage earners and the $1.25M S3 return', () => {
    expect(computeFederal(S1).mayOweAmt).toBe(false);
    const r = computeFederal(S3);
    expect(r.ledger.get('amt.4')).toBe(usd(1_120_000)); // taxable income + $10,000 SALT added back
    expect(r.ledger.get('amt.5')).toBe(0); // exemption fully phased out
    expect(r.mayOweAmt).toBe(false);
  });

  it('flags possible AMT when private activity bond interest is large', () => {
    const f = facts({
      w2s: [w2({ box1Wages: usd(300_000), box2FedWithheld: usd(70_000) })],
      f1099Int: [int1099({ box8TaxExemptInterest: usd(400_000), box9PrivateActivityBondInterest: usd(400_000) })],
    });
    const r = computeFederal(f);
    expect(r.ledger.get('amt.4')).toBe(usd(700_000)); // 284,250 + 15,750 standard deduction + 400,000 PAB
    expect(r.ledger.get('amt.5')).toBe(usd(69_687)); // 88,100 − 25% × 73,650 (rounded)
    expect(r.ledger.get('amt.6')).toBe(usd(630_313));
    expect(r.mayOweAmt).toBe(true);
  });
});
