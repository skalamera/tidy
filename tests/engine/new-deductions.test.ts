import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd as dollars } from '../../src/engine/money';
import { FED_2026 } from '../../src/engine/params/fed2026';
import { federalValues } from '../../src/main/pdf/fill';
import { div1099, facts, r1099, w2 } from '../fixtures/facts';

const spouse = { firstName: 'Blair', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-05-05' };
const VIN = '1M8GDM9AXKP042788';

describe('Schedule 1-A Parts II–IV: tips, overtime and car loan interest', () => {
  it('caps each deduction and shrinks it by income, exactly as the form’s lines do', () => {
    const f = facts({
      filingStatus: 'mfj',
      spouse,
      w2s: [w2({ box1Wages: dollars(320_000) })],
      newDeductions: { tips: dollars(30_000), overtime: dollars(30_000), carLoans: [{ vin: VIN, interest: dollars(12_000) }] },
    });
    const { ledger } = computeFederal(f);
    expect(ledger.get('sch1A.3')).toBe(dollars(320_000));
    // Tips: $25,000 cap; $20,000 over $300,000 → 20 × $100 = $2,000 less.
    expect(ledger.get('sch1A.4a')).toBe(dollars(30_000)); // one employer
    expect(ledger.get('sch1A.7')).toBe(dollars(25_000));
    expect(ledger.get('sch1A.11')).toBe(dollars(20)); // a count, printed as "20"
    expect(ledger.get('sch1A.13')).toBe(dollars(23_000));
    // Overtime: $25,000 joint cap, the same reduction.
    expect(ledger.get('sch1A.15')).toBe(dollars(25_000));
    expect(ledger.get('sch1A.21')).toBe(dollars(23_000));
    // Car loan interest: $10,000 cap; $120,000 over $200,000 → 120 × $200 = $24,000 less, so nothing left.
    expect(ledger.get('sch1A.24')).toBe(dollars(10_000));
    expect(ledger.get('sch1A.29')).toBe(dollars(24_000));
    expect(ledger.get('sch1A.30')).toBe(0);
    expect(ledger.get('sch1A.38')).toBe(dollars(46_000));
    expect(ledger.get('f1040.13b')).toBe(dollars(46_000));
    const filled = federalValues('sch1A', f, computeFederal(f)).values.text;
    expect(filled.vin1).toBe(VIN);
    expect(filled['sch1A.13']).toBe('23,000');
  });

  it('rounds the car loan reduction up to the next $1,000, and the tips one down', () => {
    const f = facts({
      w2s: [w2({ box1Wages: dollars(100_501) })],
      newDeductions: { tips: dollars(1_000), overtime: 0, carLoans: [{ vin: VIN, interest: dollars(12_000) }] },
    });
    const { ledger } = computeFederal(f);
    expect(ledger.get('sch1A.28')).toBe(dollars(1)); // $501 over → 1
    expect(ledger.get('sch1A.30')).toBe(dollars(9_800));
    expect(ledger.get('sch1A.13')).toBe(dollars(1_000)); // under $150,000: no reduction
    expect(ledger.get('sch1A.38')).toBe(dollars(10_800));
  });

  it('gives married filing separately the car loan deduction only', () => {
    const f = facts({
      filingStatus: 'mfs',
      spouse,
      w2s: [w2({ box1Wages: dollars(50_000) })],
      newDeductions: { tips: dollars(5_000), overtime: dollars(5_000), carLoans: [{ vin: VIN, interest: dollars(3_000) }] },
    });
    const { ledger } = computeFederal(f);
    expect(ledger.has('sch1A.13')).toBe(false);
    expect(ledger.has('sch1A.21')).toBe(false);
    expect(ledger.get('sch1A.38')).toBe(dollars(3_000));
  });
});

describe('foreign tax credit without Form 1116', () => {
  const withForeignTax = (cents: number, claim: boolean | undefined, filingStatus: 'single' | 'mfj' = 'mfj') =>
    computeFederal(
      facts({
        filingStatus,
        spouse: filingStatus === 'mfj' ? spouse : null,
        w2s: [w2({ box1Wages: dollars(80_000) })],
        f1099Div: [div1099({ box7ForeignTaxPaid: cents })],
        claimForeignTaxCredit: claim,
      }),
    ).ledger;

  it('claims 1099 foreign tax up to $600 joint ($300 otherwise) on Schedule 3 line 1, once the user says yes', () => {
    const l = withForeignTax(25_040, true);
    expect(l.get('sch3.1')).toBe(dollars(250));
    expect(l.get('sch3.8')).toBe(dollars(250));
    expect(l.get('f1040.20')).toBe(dollars(250));
    expect(withForeignTax(25_040, undefined).has('sch3.1')).toBe(false);
    expect(withForeignTax(65_000, true).has('sch3.1')).toBe(false); // over $600: needs Form 1116
    expect(withForeignTax(35_000, true, 'single').has('sch3.1')).toBe(false); // over $300
  });
});

describe('qualified charitable distributions', () => {
  it('are tax-free only up to $108,000 for each IRA owner', () => {
    const ira = (owner: 'taxpayer' | 'spouse', gross: number, qcd: number) =>
      r1099({
        owner,
        iraSepSimple: true,
        box1GrossDistribution: dollars(gross),
        box2aTaxableAmount: dollars(gross),
        qcdAmount: dollars(qcd),
      });
    const one = computeFederal(facts({ f1099R: [ira('taxpayer', 150_000, 120_000)] })).ledger;
    expect(one.get('f1040.4a')).toBe(dollars(150_000));
    expect(one.get('f1040.4b')).toBe(dollars(42_000));
    const two = computeFederal(
      facts({ filingStatus: 'mfj', spouse, f1099R: [ira('taxpayer', 100_000, 100_000), ira('spouse', 100_000, 100_000)] }),
    ).ledger;
    expect(two.get('f1040.4b')).toBe(0);
  });
});

describe('2026 itemized deduction limit (the 2/37 rule)', () => {
  it('adds the itemized deductions back into taxable income before comparing it with the 37% bracket', () => {
    expect(FED_2026.itemizedTopBracketLimit.bracket37Start.mfj).toBe(dollars(768_700));
    const f = facts({
      taxYear: 2026,
      filingStatus: 'mfj',
      spouse,
      w2s: [w2({ box1Wages: dollars(800_000), box2FedWithheld: dollars(200_000) })],
      itemized: {
        medicalExpenses: 0,
        stateIncomeTaxPayments: [],
        realEstateTax: 0,
        personalPropertyTax: 0,
        mortgageInterest1098: 0,
        investmentInterest: 0,
        charityCash: dollars(100_000),
        charityNonCash: 0,
        charityCarryover: 0,
      },
    });
    const { ledger } = computeFederal(f);
    expect(ledger.get('schA.14')).toBe(dollars(96_000)); // after the 0.5%-of-income floor
    // Taxable income before the rule plus the itemized deductions is $800,000: $31,300 over $768,700, which is less
    // than $96,000, so the reduction is 2/37 × $31,300 = $1,691.89.
    expect(ledger.get('schA.17.limit37')).toBe(dollars(1_692));
    expect(ledger.get('schA.17')).toBe(dollars(94_308));
  });
});
