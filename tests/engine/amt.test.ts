import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeForm6251 } from '../../src/engine/federal/form6251';
import { Ledger } from '../../src/engine/ledger';
import { FED_2025 } from '../../src/engine/params/fed2025';
import { div1099, facts, int1099, r1099, S1, ssa1099, w2 } from '../fixtures/facts';

describe('Form 6251 (2025)', () => {
  it('owes no AMT and attaches nothing for an ordinary wage earner', () => {
    const r = computeFederal(S1);
    expect(r.amt.amt).toBe(0);
    expect(r.amt.needsForm6251).toBe(false);
    expect(r.forms).not.toContain('f6251');
  });

  it('doesn’t flag a 65+ couple with a pension, Social Security and capital gains (Part III rates apply)', () => {
    const f = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-05-05' },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1956-06-06' },
      f1099R: [r1099({ box1GrossDistribution: usd(80_000), box2aTaxableAmount: usd(80_000) })],
      ssa1099: [ssa1099({ box5NetBenefits: usd(40_000) })],
      f1099Div: [
        div1099({ box1aOrdinaryDividends: usd(20_000), box1bQualifiedDividends: usd(20_000), box2aCapitalGainDistributions: usd(100_000) }),
      ],
    });
    const r = computeFederal(f);
    expect(r.amt.amt).toBe(0);
    expect(r.forms).not.toContain('f6251');
  });

  it('taxes private activity bond interest (worked by hand)', () => {
    // Single: AGI $250,000, standard deduction $15,750, $200,000 of private activity bond interest.
    // AMTI = 234,250 + 15,750 + 200,000 = 450,000; exemption 88,100; line 6 = 361,900;
    // line 7 = 28% × 361,900 − 4,782 = 96,550; regular tax on 234,250 = 52,023; AMT = 44,527.
    const f = facts({
      w2s: [w2({ box1Wages: usd(250_000) })],
      f1099Int: [int1099({ box8TaxExemptInterest: usd(200_000), box9PrivateActivityBondInterest: usd(200_000) })],
    });
    const r = computeFederal(f);
    expect(r.ledger.get('f6251.4')).toBe(usd(450_000));
    expect(r.ledger.get('f6251.5')).toBe(usd(88_100));
    expect(r.ledger.get('f6251.7')).toBe(usd(96_550));
    expect(r.ledger.get('f1040.16')).toBe(usd(52_023));
    expect(r.amt.amt).toBe(usd(44_527));
    expect(r.ledger.get('sch2.2')).toBe(usd(44_527));
    expect(r.ledger.get('f1040.17')).toBe(usd(44_527));
    expect(r.forms).toContain('f6251');
    expect(r.forms.indexOf('f6251')).toBeGreaterThan(r.forms.indexOf('sch2'));
  });

  it('phases out the exemption at 25% above $626,350 (Exemption Worksheet)', () => {
    const f = facts({
      w2s: [w2({ box1Wages: usd(250_000) })],
      f1099Int: [int1099({ box8TaxExemptInterest: usd(500_000), box9PrivateActivityBondInterest: usd(500_000) })],
    });
    const r = computeFederal(f);
    expect(r.ledger.get('f6251.4')).toBe(usd(750_000));
    expect(r.ledger.get('f6251.5')).toBe(usd(57_187)); // 88,100 − 25% × 123,650 (30,912.50 rounds to 30,913)
    expect(r.ledger.get('f6251.7')).toBe(usd(189_206)); // 28% × 692,813 − 4,782
  });

  it('uses Part III capital gain rates (worked by hand)', () => {
    // Single: wages 150,000, qualified dividends 50,000, PAB interest 300,000 -> AMTI 500,000, line 6 411,900.
    // Part III: 17 = 361,900 -> 96,550; 30 = 50,000 at 15% = 7,500; 38 = 104,050 < 39 = 110,550.
    // Regular tax (QDCG worksheet) = 25,067 + 7,500 = 32,567; AMT = 71,483.
    const f = facts({
      w2s: [w2({ box1Wages: usd(150_000) })],
      f1099Div: [div1099({ box1aOrdinaryDividends: usd(50_000), box1bQualifiedDividends: usd(50_000) })],
      f1099Int: [int1099({ box8TaxExemptInterest: usd(300_000), box9PrivateActivityBondInterest: usd(300_000) })],
    });
    const r = computeFederal(f);
    expect(r.ledger.get('f6251.12')).toBe(usd(411_900));
    expect(r.ledger.get('f6251.18')).toBe(usd(96_550));
    expect(r.ledger.get('f6251.31')).toBe(usd(7_500));
    expect(r.ledger.get('f6251.38')).toBe(usd(104_050));
    expect(r.ledger.get('f6251.39')).toBe(usd(110_550));
    expect(r.ledger.get('f6251.7')).toBe(usd(104_050));
    expect(r.ledger.get('f1040.16')).toBe(usd(32_567));
    expect(r.amt.amt).toBe(usd(71_483));
  });

  it('adds K-1 AMT items to lines 2j, 2k, 2l and 3', () => {
    const l = new Ledger();
    l.set('f1040.11b', usd(100_000), 'AGI');
    l.set('f1040.14', usd(15_750), 'Deductions');
    l.set('f1040.12e', usd(15_750), 'Standard deduction');
    const f = facts({
      k1s: [
        {
          id: 'k',
          owner: 'taxpayer',
          entityType: '1065',
          entityName: 'LP',
          entityEin: '',
          ordinaryBusinessIncome: 0,
          netRentalRealEstateIncome: 0,
          interestIncome: 0,
          ordinaryDividends: 0,
          qualifiedDividends: 0,
          netShortTermCapitalGain: 0,
          netLongTermCapitalGain: 0,
          netSection1231Gain: 0,
          amtDepreciationAdjustment: usd(1_200),
          amtGainLossAdjustment: usd(-300),
          amtOtherAdjustments: usd(50),
          amtEstateTrustAdjustment: usd(10),
        },
      ],
    });
    const out = computeForm6251(
      f,
      {
        itemizing: false,
        schedule1A: 0,
        stateRefundIncome: 0,
        passiveAdjustments: 0,
        passiveLossLimited: false,
        worksheet: 'none',
        foreignTaxCredit: 0,
      },
      FED_2025,
      l,
    );
    expect(l.get('f6251.2l')).toBe(usd(1_200));
    expect(l.get('f6251.2k')).toBe(usd(-300));
    expect(l.get('f6251.3')).toBe(usd(50));
    expect(l.get('f6251.2j')).toBe(usd(10));
    expect(l.get('f6251.4')).toBe(usd(100_000 + 960));
    expect(out.passiveUncertain).toBe(false);
  });
});
