import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { usd as dollars } from '../../src/engine/money';
import { FED_2026 } from '../../src/engine/params/fed2026';
import { federalValues } from '../../src/main/pdf/fill';
import { mdValues } from '../../src/main/pdf/stateValues';
import { facts as baseFacts, w2 as makeW2 } from '../fixtures/facts';

describe('Milestone A7: Tax year 2026 (Rev. Proc. 2025-32 & OBBBA law changes) and payment vouchers (Form 1040-V & MD Form PV)', () => {
  it('applies 2026 Rev. Proc. 2025-32 standard deductions ($32,200 MFJ, $16,100 single, $2,050/$1,650 65+), brackets, and $184,500 Social Security wage base', () => {
    expect(FED_2026.standardDeduction.mfj).toBe(dollars(32_200));
    expect(FED_2026.standardDeduction.single).toBe(dollars(16_100));
    expect(FED_2026.standardDeduction.hoh).toBe(dollars(24_150));
    expect(FED_2026.additionalStandardDeduction65OrBlind.singleOrHoh).toBe(dollars(2_050));
    expect(FED_2026.additionalStandardDeduction65OrBlind.marriedOrQss).toBe(dollars(1_650));
    expect(FED_2026.socialSecurity.wageBase).toBe(dollars(184_500));

    // MFJ couple in 2026 with $133,000 wages and $1,500 cash charity (non-itemizer deduction = $1,500, capped at $2,000):
    // Standard deduction = $32,200, non-itemizer charity on line 13b = $1,500 -> Total deductions = $33,700 -> Taxable income = $99,300
    const f = baseFacts({
      taxYear: 2026,
      filingStatus: 'mfj',
      spouse: { firstName: 'Blair', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-05-05' },
      w2s: [makeW2({ box1Wages: dollars(133_000), box2FedWithheld: dollars(15_000) })],
      itemized: {
        medicalExpenses: 0,
        stateIncomeTaxPayments: [],
        realEstateTax: 0,
        personalPropertyTax: 0,
        mortgageInterest1098: 0,
        investmentInterest: 0,
        charityCash: dollars(1_500),
        charityNonCash: 0,
        charityCarryover: 0,
      },
    });
    const fed = computeFederal(f);
    expect(fed.itemizing).toBe(false);
    expect(fed.ledger.get('f1040.12e')).toBe(dollars(32_200));
    expect(fed.ledger.get('f1040.12b')).toBe(dollars(1_500));
    expect(fed.ledger.get('f1040.13b')).toBe(dollars(1_500));
    expect(fed.ledger.get('f1040.14')).toBe(dollars(33_700));
    expect(fed.taxableIncome).toBe(dollars(99_300));
  });

  it('enforces the 2026 $40,400 SALT cap with 30% phase-down above $505,000 MAGI (floored at $10,000)', () => {
    // At MAGI = $600,000 (excess $95,000 over $505,000):
    // Reduction = 30% * $95,000 = $28,500 -> Effective SALT cap = $40,400 - $28,500 = $11,900
    const f = baseFacts({
      taxYear: 2026,
      filingStatus: 'mfj',
      spouse: { firstName: 'Blair', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-05-05' },
      w2s: [
        makeW2({
          box1Wages: dollars(600_000),
          box2FedWithheld: dollars(140_000),
          stateLines: [{ state: 'MD', stateWages: dollars(600_000), stateTax: dollars(35_000) }],
        }),
      ],
      itemized: {
        medicalExpenses: 0,
        stateIncomeTaxPayments: [],
        realEstateTax: dollars(15_000),
        personalPropertyTax: 0,
        mortgageInterest1098: dollars(25_000),
        investmentInterest: 0,
        charityCash: 0,
        charityNonCash: 0,
        charityCarryover: 0,
      },
    });
    const fed = computeFederal(f);
    expect(fed.ledger.get('schA.5d')).toBe(dollars(50_000));
    expect(fed.ledger.get('schA.5e')).toBe(dollars(11_900));
  });

  it('applies the 2026 0.5%-of-AGI floor on itemized charitable gifts and the 2/37 reduction for the 37% bracket (Baker Tilly $1M AGI / $100k gift worked example)', () => {
    // Baker Tilly 2026 case study:
    // AGI = $1,000,000, Charitable contribution = $100,000
    // 0.5% of AGI floor = $5,000 -> Deductible charitable contribution before 37% limit = $95,000
    // Suppose only the $100,000 charitable gift is itemized (or forceItemize = true):
    // Taxable income before 37% limit = $1,000,000 - $95,000 = $905,000 (which exceeds the $768,700 MFJ 37% threshold by $136,300 > $95,000).
    // 2/37 reduction on $95,000 = round($95,000 * 2 / 37) = $5,135
    // Net itemized deduction = $95,000 - $5,135 = $89,865
    const f = baseFacts({
      taxYear: 2026,
      filingStatus: 'mfj',
      spouse: { firstName: 'Blair', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-05-05' },
      w2s: [makeW2({ box1Wages: dollars(1_000_000), box2FedWithheld: dollars(300_000) })],
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
    const fed = computeFederal(f);
    expect(fed.ledger.get('schA.14.floor')).toBe(dollars(5_000));
    expect(fed.ledger.get('schA.14')).toBe(dollars(95_000));
    expect(fed.ledger.get('schA.17.limit37')).toBe(dollars(5_135));
    expect(fed.ledger.get('schA.17')).toBe(dollars(89_865));
    expect(fed.ledger.get('f1040.12e')).toBe(dollars(89_865));
  });

  it('attaches and populates Federal Form 1040-V and Maryland Form PV payment vouchers when a balance is due, and omits them when refunded', () => {
    const fOwed = baseFacts({
      filingStatus: 'mfj',
      spouse: { firstName: 'Blair', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-05-05' },
      w2s: [
        makeW2({
          box1Wages: dollars(180_000),
          box2FedWithheld: dollars(15_000),
          stateLines: [{ state: 'MD', stateWages: dollars(180_000), stateTax: dollars(8_000) }],
        }),
      ],
    });
    const fedOwed = computeFederal(fOwed);
    const mdOwed = computeMd(fOwed, fedOwed);
    expect(fedOwed.amountOwed).toBeGreaterThan(0);
    expect(mdOwed.amountOwed).toBeGreaterThan(0);
    expect(fedOwed.forms).toContain('f1040v');
    expect(mdOwed.forms).toContain('mdpv');

    const v1040 = federalValues('f1040v', fOwed, fedOwed).values;
    expect(v1040.text.ssn).toBe('400-00-0001');
    expect(v1040.text.spouseSsn).toBe('400-00-0002');
    expect(v1040.text['f1040v.3']).toMatch(/\.00$/);

    const vMd = mdValues('mdpv', fOwed, mdOwed);
    expect(vMd.text.taxYear502).toBe('25');
    expect(vMd.text['mdpv.dollars']).toBe(String(Math.round(mdOwed.amountOwed / 100)));
    expect(vMd.text['mdpv.cents']).toBe('00');
    expect(vMd.choices?.paymentType).toBe('resident502');

    // When overpaid / refunded, neither voucher is attached
    const fRefund = baseFacts({
      w2s: [
        makeW2({
          box1Wages: dollars(100_000),
          box2FedWithheld: dollars(25_000),
          stateLines: [{ state: 'MD', stateWages: dollars(100_000), stateTax: dollars(10_000) }],
        }),
      ],
    });
    const fedRefund = computeFederal(fRefund);
    const mdRefund = computeMd(fRefund, fedRefund);
    expect(fedRefund.forms).not.toContain('f1040v');
    expect(mdRefund.forms).not.toContain('mdpv');
  });
});
