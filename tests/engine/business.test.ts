import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { facts, w2 } from '../fixtures/facts';
import type { ScheduleCBusiness, TaxFacts } from '../../src/shared/facts';

const baseFacts = (p: Partial<TaxFacts> = {}) =>
  facts({
    filingStatus: 'mfj',
    spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-02-02' },
    ...p,
  });

function biz(overrides: Partial<ScheduleCBusiness> = {}): ScheduleCBusiness {
  return {
    id: 'biz-1',
    owner: 'taxpayer',
    principalBusiness: 'Management consulting',
    businessCode: '541610',
    businessName: 'Rivera Advisory',
    ein: null,
    isSstb: true,
    expenses: {},
    ...overrides,
  };
}

describe('Milestone A3 — Schedule C, Schedule SE, SEP deduction, Form 7206, Form 8829, and Form 4797', () => {
  it('skips Schedule C, SE, 7206, 8829, and 4797 when the business closed in 2024', () => {
    const f = baseFacts({
      w2s: [w2({ box1Wages: usd(100_000) })],
      scheduleC: [biz({ closedInPriorYear: true, additionalGrossReceipts: usd(50_000) })],
    });
    const res = computeFederal(f);
    expect(res.ledger.get('sch1.3')).toBe(0);
    expect(res.ledger.get('f1040.8')).toBe(0);
    expect(res.forms).not.toContain('schC');
    expect(res.forms).not.toContain('schSE');
  });

  it('computes Schedule C with simplified home office, Schedule SE (with W-2 SS wage cap coordination), SEP deduction, Form 7206, and Form 8995 QBI', () => {
    // Taxpayer has $100,000 W-2 SS wages + $80,000 1099-NEC consulting receipts, $8,500 expenses,
    // simplified home office (200 sq ft of 2,000 sq ft = $1,000), max SEP, and $6,000 health insurance.
    const f = baseFacts({
      w2s: [w2({ owner: 'taxpayer', box1Wages: usd(100_000), box3SsWages: usd(100_000), box5MedicareWages: usd(100_000) })],
      f1099Nec: [
        {
          id: 'nec-1',
          owner: 'taxpayer',
          payerName: 'Client Co',
          payerEin: '12-3456789',
          box1NonemployeeCompensation: usd(80_000),
          box4FedWithheld: usd(2_000),
          stateLines: [{ state: 'MD', stateTax: usd(1_000), stateIncome: usd(80_000) }],
          evidence: {},
        },
      ],
      scheduleC: [
        biz({
          expenses: {
            legalAndProfessional: usd(3_000),
            officeExpense: usd(2_000),
            travel: usd(2_500),
            deductibleMeals: usd(1_000),
          },
          homeOffice: {
            method: 'simplified',
            businessSqFt: 200,
            totalSqFt: 2000,
          },
          sepContribution: 'max',
          healthInsurancePremiums: usd(6_000),
        }),
      ],
    });
    const res = computeFederal(f);
    const l = res.ledger;

    // Schedule C:
    // Line 1 = $80,000; Line 28 = $8,500; Line 29 = $71,500; Line 30 (simplified 200 * $5) = $1,000; Line 31 = $70,500
    expect(l.get('schC.1')).toBe(usd(80_000));
    expect(l.get('schC.28')).toBe(usd(8_500));
    expect(l.get('schC.29')).toBe(usd(71_500));
    expect(l.get('schC.30')).toBe(usd(1_000));
    expect(l.get('schC.31')).toBe(usd(70_500));
    expect(l.get('sch1.3')).toBe(usd(70_500));

    // Schedule SE:
    // Line 2 = $70,500; Line 4a = $70,500 * 92.35% = $65,107;
    // W-2 SS wages = $100,000 -> remaining SS cap (line 9) = $176,100 - $100,000 = $76,100
    // Line 10 = min($65,107, $76,100) * 12.4% = $8,073
    // Line 11 = $65,107 * 2.9% = $1,888
    // Line 12 = $8,073 + $1,888 = $9,961 -> Schedule 2 line 4
    // Line 13 = 50% of $9,961 = $4,981 -> Schedule 1 line 15
    expect(l.get('schSE.4a')).toBe(usd(65_107));
    expect(l.get('schSE.9')).toBe(usd(76_100));
    expect(l.get('schSE.10')).toBe(usd(8_073));
    expect(l.get('schSE.11')).toBe(usd(1_888));
    expect(l.get('schSE.12')).toBe(usd(9_961));
    expect(l.get('schSE.13')).toBe(usd(4_981));
    expect(l.get('sch2.4')).toBe(usd(9_961));
    expect(l.get('sch1.15')).toBe(usd(4_981));

    // SEP deduction (Schedule 1 line 16):
    // 20% of ($70,500 - $4,981 = $65,519) = $13,104
    expect(l.get('sch1.16')).toBe(usd(13_104));

    // Form 7206 (Self-Employed Health Insurance Deduction -> Schedule 1 line 17):
    // Line 1 = $6,000; Line 4 = $70,500; Line 7 = $4,981; Line 8 = $65,519; Line 9 = $13,104; Line 10 = $52,415; Line 14 = $6,000
    expect(l.get('f7206.1')).toBe(usd(6_000));
    expect(l.get('f7206.10')).toBe(usd(52_415));
    expect(l.get('f7206.14')).toBe(usd(6_000));
    expect(l.get('sch1.17')).toBe(usd(6_000));

    // Total adjustments (Schedule 1 line 26 -> Form 1040 line 10): $4,981 + $13,104 + $6,000 = $24,085
    expect(l.get('sch1.26')).toBe(usd(24_085));
    expect(l.get('f1040.10')).toBe(usd(24_085));

    // QBI (Form 8995):
    // Net QBI = Schedule C profit ($70,500) - 1/2 SE tax ($4,981) - SEP ($13,104) - SE health insurance ($6,000) = $46,415
    // 20% QBI deduction = $9,283 (since taxable income before QBI is well below the $394,600 MFJ threshold)
    expect(l.get('f8995.2')).toBe(usd(46_415));
    expect(l.get('f8995.5')).toBe(usd(9_283));
    expect(l.get('f1040.13a')).toBe(usd(9_283));

    // 1099-NEC federal & MD withholding:
    expect(l.get('f1040.25b')).toBe(usd(2_000));
    const md = computeMd(f, res);
    expect(md.ledger.get('md502.41')).toBe(usd(1_000));

    expect(res.forms).toEqual(expect.arrayContaining(['sch1', 'sch2', 'schC', 'schSE', 'f8995', 'f7206']));
  });

  it('computes Form 8829 regular home office deduction and prevents double-counting mortgage interest and property tax on Schedule A', () => {
    const f = baseFacts({
      scheduleC: [
        biz({
          additionalGrossReceipts: usd(60_000),
          expenses: { officeExpense: usd(5_000) },
          homeOffice: {
            method: 'regular',
            businessSqFt: 300,
            totalSqFt: 2_000, // 15.00%
            indirectUtilities: usd(4_000),
            indirectInsurance: usd(2_000),
            homeAdjustedBasisOrFmv: usd(500_000),
            homeLandValue: usd(100_000), // building basis $400,000 -> business basis 15% = $60,000 -> 2.564% = $1,538
          },
        }),
      ],
      itemized: {
        ...facts().itemized,
        mortgageInterest1098: usd(20_000),
        realEstateTax: usd(12_000),
        charityCash: usd(20_000),
      },
    });
    const res = computeFederal(f);
    const l = res.ledger;
    // Form 8829:
    // Business % = 15%
    // Line 8 (tentative profit) = $55,000
    // Line 10b = $20,000, Line 11b = $12,000 -> Line 12b = $32,000 -> Line 13 (15%) = $4,800
    // Line 18b = $2,000, Line 21b = $4,000 -> Line 23b = $6,000 -> Line 24 (15%) = $900
    // Line 40 = $60,000, Line 42 (2.564%) = $1,538 -> Line 30 = $1,538
    // Line 36 = $4,800 + $900 + $1,538 = $7,238 -> Schedule C line 30
    expect(l.get('f8829.13')).toBe(usd(4_800));
    expect(l.get('f8829.24')).toBe(usd(900));
    expect(l.get('f8829.42')).toBe(usd(1_538));
    expect(l.get('f8829.36')).toBe(usd(7_238));
    expect(l.get('schC.30')).toBe(usd(7_238));
    expect(l.get('schC.31')).toBe(usd(47_762));
    // Schedule A mortgage interest and real estate tax are reduced by the 15% deducted on Form 8829 ($3,000 and $1,800):
    expect(l.get('schA.5b')).toBe(usd(10_200));
    expect(l.get('schA.8a')).toBe(usd(17_000));
    expect(res.forms).toContain('f8829');
  });

  it('computes Form 4797 dispositions when closing the business: sold equipment (§1245 recapture + §1231 gain), scrapped equipment (ordinary loss), and personal conversion', () => {
    const f = baseFacts({
      scheduleC: [
        biz({
          additionalGrossReceipts: usd(40_000),
          assetDispositions: [
            // 1. Sold office equipment above original cost: cost $5,000, depr $5,000, sold for $6,000
            // -> Total gain $6,000: $5,000 §1245 ordinary recapture (Part III line 25b -> line 31 -> line 13) + $1,000 §1231 LT gain (line 32 -> line 6 -> line 7 -> Schedule D line 11)
            {
              description: 'Mac Studio & Displays',
              dateAcquired: '03/10/2022',
              dateDisposed: '11/15/2025',
              disposition: 'sold',
              salesPrice: usd(6_000),
              costBasis: usd(5_000),
              depreciationAllowed: usd(5_000),
            },
            // 2. Scrapped / abandoned office furniture with unrecovered basis: cost $3,000, depr $1,800, scrapped for $0
            // -> -$1,200 ordinary loss on Form 4797 Part II line 10
            {
              description: 'Office Desk & Chairs',
              dateAcquired: '05/01/2023',
              dateDisposed: '12/01/2025',
              disposition: 'scrapped',
              salesPrice: 0,
              costBasis: usd(3_000),
              depreciationAllowed: usd(1_800),
            },
            // 3. Laptop kept for personal use (fully depreciated after recovery period): no gain or loss
            {
              description: 'MacBook Pro',
              dateAcquired: '01/15/2020',
              dateDisposed: '12/31/2025',
              disposition: 'personal',
              salesPrice: 0,
              costBasis: usd(2_500),
              depreciationAllowed: usd(2_500),
            },
          ],
        }),
      ],
    });
    const res = computeFederal(f);
    const l = res.ledger;
    // Part III: total gain $6,000 (line 30), §1245 recapture $5,000 (line 31), §1231 gain $1,000 (line 32 -> line 6 -> line 7 -> Schedule D line 11)
    expect(l.get('f4797.30')).toBe(usd(6_000));
    expect(l.get('f4797.31')).toBe(usd(5_000));
    expect(l.get('f4797.32')).toBe(usd(1_000));
    expect(l.get('f4797.7')).toBe(usd(1_000));
    expect(l.get('schD.11')).toBe(usd(1_000));
    expect(l.get('f1040.7a')).toBe(usd(1_000));
    // Part II: -$1,200 scrapped loss (line 10) + $5,000 recapture (line 13) = +$3,800 ordinary gain (line 17 / 18b -> Schedule 1 line 4)
    expect(l.get('f4797.13')).toBe(usd(5_000));
    expect(l.get('f4797.17')).toBe(usd(3_800));
    expect(l.get('f4797.18b')).toBe(usd(3_800));
    expect(l.get('sch1.4')).toBe(usd(3_800));
    expect(res.forms).toContain('f4797');
    expect(res.forms).toContain('schD');
  });
});
