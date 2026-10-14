import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMaryland } from '../../src/engine/md/form502';
import { usd as dollars } from '../../src/engine/money';
import { facts as baseFacts, w2 as makeW2 } from '../fixtures/facts';

describe('Milestone A4: Schedule E (rentals & K-1s), Form 4562, Form 8582, Form 7203, and MD Form 500DM', () => {
  it('computes rental property income & Form 4562 mid-month residential MACRS depreciation on Schedule E Part I', () => {
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(100_000) })],
      rentals: [
        {
          id: 'rent-1',
          owner: 'taxpayer',
          address: '100 Harbor View Rd, Annapolis, MD 21401',
          propertyType: 1, // Single Family Residence
          fairRentalDays: 365,
          personalUseDays: 0,
          activeParticipation: true,
          rentsReceived: dollars(36_000),
          expenses: {
            insurance: dollars(1_800),
            mortgageInterest: dollars(9_200),
            repairs: dollars(2_000),
            taxes: dollars(4_000),
            utilities: dollars(1_000),
          },
          depreciableAssets: [
            {
              description: 'Single-family rental building',
              placedInService: '06/2025',
              basis: dollars(275_000),
              recoveryPeriodYears: 27.5,
              placedInServiceIn2025: true,
            },
          ],
        },
      ],
    });
    const fed = computeFederal(f);
    // June (month 6) mid-month 27.5-year residential MACRS table rate = 1.970% (6.5 / 12 / 27.5 = 1.96969...% -> 1.970% in Pub 946 Table A-6)
    // $275,000 * 1.970% = $5,417.50 -> $5,418
    expect(fed.scheduleE.needsForm4562).toBe(true);
    expect(fed.ledger.get('f4562.19i.g')).toBe(dollars(5_418));
    expect(fed.ledger.get('f4562.22')).toBe(dollars(5_418));
    expect(fed.ledger.get('schE.18.A')).toBe(dollars(5_418));
    // Total expenses = 1800 + 9200 + 2000 + 4000 + 1000 + 5418 = $23,418
    expect(fed.ledger.get('schE.20.A')).toBe(dollars(23_418));
    // Net rental income = 36,000 - 23,418 = $12,582
    expect(fed.ledger.get('schE.21.A')).toBe(dollars(12_582));
    expect(fed.ledger.get('schE.24')).toBe(dollars(12_582));
    expect(fed.ledger.get('schE.26')).toBe(dollars(12_582));
    expect(fed.ledger.get('sch1.5')).toBe(dollars(12_582));
    expect(fed.ledger.get('f1040.8')).toBe(dollars(12_582));
    expect(fed.agi).toBe(dollars(112_582));
  });

  it('applies Form 8582 $25,000 special rental real estate loss allowance with phase-out between $100k and $150k MAGI', () => {
    // W-2 wages = $120,000 -> MAGI = $120,000
    // $150,000 - $120,000 = $30,000 * 50% = $15,000 special allowance on Form 8582 line 9
    // Rental loss = -$22,000 -> -$15,000 allowed on Schedule E line 22, -$7,000 suspended carryover to 2026
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(120_000) })],
      rentals: [
        {
          id: 'rent-loss',
          owner: 'taxpayer',
          address: '200 Bay St, Easton, MD 21601',
          propertyType: 1,
          fairRentalDays: 365,
          personalUseDays: 0,
          activeParticipation: true,
          rentsReceived: dollars(18_000),
          expenses: {
            mortgageInterest: dollars(20_000),
            taxes: dollars(8_000),
            repairs: dollars(4_000),
            depreciation: dollars(8_000),
          },
        },
      ],
    });
    const fed = computeFederal(f);
    expect(fed.ledger.get('schE.21.A')).toBe(-dollars(22_000));
    expect(fed.scheduleE.needsForm8582).toBe(true);
    expect(fed.ledger.get('f8582.1b')).toBe(dollars(22_000));
    expect(fed.ledger.get('f8582.1d')).toBe(-dollars(22_000));
    expect(fed.ledger.get('f8582.3')).toBe(-dollars(22_000));
    expect(fed.ledger.get('f8582.4')).toBe(dollars(22_000));
    expect(fed.ledger.get('f8582.5')).toBe(dollars(150_000));
    expect(fed.ledger.get('f8582.6')).toBe(dollars(120_000));
    expect(fed.ledger.get('f8582.7')).toBe(dollars(30_000));
    expect(fed.ledger.get('f8582.8')).toBe(dollars(15_000));
    expect(fed.ledger.get('f8582.9')).toBe(dollars(15_000));
    expect(fed.ledger.get('f8582.11')).toBe(dollars(15_000));
    // Deductible rental loss on Schedule E line 22 is $15,000 (shown as negative -$15,000 on line 25/26/sch1.5)
    expect(fed.ledger.get('schE.22.A')).toBe(dollars(15_000));
    expect(fed.ledger.get('schE.25')).toBe(dollars(15_000));
    expect(fed.ledger.get('schE.26')).toBe(-dollars(15_000));
    expect(fed.ledger.get('sch1.5')).toBe(-dollars(15_000));
    expect(fed.scheduleE.passiveLossCarryoverTo2026).toBe(dollars(7_000));
    expect(fed.agi).toBe(dollars(105_000));
  });

  it('suspends passive rental & K-1 losses above $150,000 MAGI except to the extent of passive income', () => {
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(200_000) })],
      rentals: [
        {
          id: 'rent-1',
          owner: 'taxpayer',
          address: '300 Ocean Pkwy, Ocean City, MD 21842',
          propertyType: 3,
          fairRentalDays: 180,
          personalUseDays: 10,
          activeParticipation: true,
          rentsReceived: dollars(15_000),
          expenses: {
            mortgageInterest: dollars(15_000),
            taxes: dollars(5_000),
            depreciation: dollars(5_000),
          },
        },
      ],
      k1s: [
        {
          id: 'k1-gain',
          owner: 'taxpayer',
          entityType: '1065',
          entityName: 'Chesapeake Real Estate LP',
          entityEin: '52-1111111',
          isMaterialParticipation: false,
          ordinaryBusinessIncome: 0,
          netRentalRealEstateIncome: dollars(4_000), // passive income
          interestIncome: 0,
          ordinaryDividends: 0,
          qualifiedDividends: 0,
          netShortTermCapitalGain: 0,
          netLongTermCapitalGain: 0,
          netSection1231Gain: 0,
        },
      ],
    });
    const fed = computeFederal(f);
    // Rental has -$10,000 loss; K-1 has +$4,000 passive income; MAGI = $200,000 >= $150,000 -> special allowance = $0
    // Allowed passive loss = $4,000 (offsetting passive income); unallowed = $6,000; net Schedule E = $4,000 - $4,000 = $0
    expect(fed.ledger.get('f8582.9')).toBe(0);
    expect(fed.ledger.get('f8582.10')).toBe(dollars(4_000));
    expect(fed.ledger.get('f8582.11')).toBe(dollars(4_000));
    expect(fed.ledger.get('schE.22.A')).toBe(dollars(4_000));
    expect(fed.ledger.get('schE.26')).toBe(-dollars(4_000));
    expect(fed.ledger.get('schE.32')).toBe(dollars(4_000));
    expect(fed.ledger.get('schE.41')).toBe(0);
    expect(fed.ledger.get('sch1.5')).toBe(0);
    expect(fed.scheduleE.passiveLossCarryoverTo2026).toBe(dollars(6_000));
  });

  it('routes K-1 (1065, 1120-S, 1041) multi-character items to Schedule B, Schedule D, Form 4797, Schedule E, Schedule SE, and Form 8995', () => {
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(80_000), box3SsWages: dollars(80_000) })],
      k1s: [
        {
          id: 'k1-1065',
          owner: 'taxpayer',
          entityType: '1065',
          entityName: 'Potomac Advisory Partners LP',
          entityEin: '52-2222222',
          isMaterialParticipation: true,
          ordinaryBusinessIncome: dollars(30_000),
          guaranteedPayments: dollars(10_000),
          netRentalRealEstateIncome: 0,
          interestIncome: dollars(1_200),
          ordinaryDividends: dollars(2_000),
          qualifiedDividends: dollars(1_500),
          netShortTermCapitalGain: dollars(3_000),
          netLongTermCapitalGain: dollars(5_000),
          netSection1231Gain: dollars(4_000),
          selfEmploymentEarnings: dollars(40_000),
          qbiAmount: dollars(30_000),
          qbiW2Wages: dollars(15_000),
        },
        {
          id: 'k1-1041',
          owner: 'spouse',
          entityType: '1041',
          entityName: 'Rivera Family Trust',
          entityEin: '52-3333333',
          ordinaryBusinessIncome: 0,
          netRentalRealEstateIncome: 0,
          interestIncome: dollars(500),
          ordinaryDividends: 0,
          qualifiedDividends: 0,
          netShortTermCapitalGain: 0,
          netLongTermCapitalGain: 0,
          netSection1231Gain: 0,
          trustOtherIncome: dollars(6_000),
        },
      ],
    });
    const fed = computeFederal(f);
    // Interest: $1,200 + $500 = $1,700 -> Schedule B / 1040 line 2b
    expect(fed.ledger.get('f1040.2b')).toBe(dollars(1_700));
    // Dividends: $2,000 ordinary, $1,500 qualified
    expect(fed.ledger.get('f1040.3a')).toBe(dollars(1_500));
    expect(fed.ledger.get('f1040.3b')).toBe(dollars(2_000));
    // Schedule D: ST gain on line 5 = $3,000; LT gain on line 12 = $5,000 + §1231 gain from Form 4797 line 7 ($4,000) on line 11 = $9,000 -> total $12,000
    expect(fed.ledger.get('schD.5')).toBe(dollars(3_000));
    expect(fed.ledger.get('f4797.7')).toBe(dollars(4_000));
    expect(fed.ledger.get('schD.11')).toBe(dollars(4_000));
    expect(fed.ledger.get('schD.12')).toBe(dollars(5_000));
    expect(fed.ledger.get('f1040.7')).toBe(dollars(12_000));
    // Schedule E Part II: $30,000 ordinary + $10,000 guaranteed payments = $40,000 nonpassive income (line 32)
    expect(fed.ledger.get('schE.32')).toBe(dollars(40_000));
    // Schedule E Part III: $6,000 trust income (line 37)
    expect(fed.ledger.get('schE.37')).toBe(dollars(6_000));
    // Schedule E Part V line 41 = $46,000 -> Schedule 1 line 5
    expect(fed.ledger.get('schE.41')).toBe(dollars(46_000));
    expect(fed.ledger.get('sch1.5')).toBe(dollars(46_000));
    // Schedule SE from K-1 box 14 code A ($40,000 * 92.35% = $36,940; SS + Medicare = $5,652; 1/2 = $2,826)
    expect(fed.ledger.get('schSE.3')).toBe(dollars(40_000));
    expect(fed.ledger.get('schSE.12')).toBe(dollars(5_652));
    expect(fed.ledger.get('sch1.15')).toBe(dollars(2_826));
    // Form 8995 QBI deduction on $30,000 K-1 QBI (adjusted for 1/2 SE tax attributable to QBI if any; or 20% of $30,000 = $6,000)
    expect(fed.qbi.deduction).toBeGreaterThan(0);
  });

  it('computes S-corporation shareholder stock & debt basis limitations on Form 7203 and excess distribution capital gain', () => {
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(100_000) })],
      k1s: [
        {
          id: 'k1-1120s',
          owner: 'taxpayer',
          entityType: '1120S',
          entityName: ' Severn Tech Inc',
          entityEin: '52-4444444',
          isMaterialParticipation: true,
          ordinaryBusinessIncome: -dollars(25_000), // -$25,000 loss
          netRentalRealEstateIncome: 0,
          interestIncome: 0,
          ordinaryDividends: 0,
          qualifiedDividends: 0,
          netShortTermCapitalGain: 0,
          netLongTermCapitalGain: 0,
          netSection1231Gain: 0,
          sCorpBasis: {
            beginningStockBasis: dollars(15_000),
            capitalContributions: 0,
            distributions: dollars(3_000),
            nondeductibleExpenses: dollars(2_000),
            beginningLoanBalance: dollars(4_000),
            beginningDebtBasis: dollars(4_000),
          },
        },
      ],
    });
    const fed = computeFederal(f);
    expect(fed.scheduleE.needsForm7203).toBe(true);
    // Stock basis: $15,000 (line 1) - $3,000 dist (line 6) = $12,000 (line 7) - $2,000 nondeductible (line 8a) = $10,000 stock basis before loss (line 10)
    expect(fed.ledger.get('f7203.1')).toBe(dollars(15_000));
    expect(fed.ledger.get('f7203.6')).toBe(dollars(3_000));
    expect(fed.ledger.get('f7203.7')).toBe(dollars(12_000));
    expect(fed.ledger.get('f7203.8a')).toBe(dollars(2_000));
    expect(fed.ledger.get('f7203.10')).toBe(dollars(10_000));
    // Allowable loss from stock basis = $10,000 (line 11 / 35c); ending stock basis = $0 (line 15)
    expect(fed.ledger.get('f7203.11')).toBe(dollars(10_000));
    expect(fed.ledger.get('f7203.15')).toBe(0);
    // Allowable loss from debt basis = $4,000 (line 30 / 35d); ending debt basis = $0 (line 31)
    expect(fed.ledger.get('f7203.29')).toBe(dollars(4_000));
    expect(fed.ledger.get('f7203.30')).toBe(dollars(4_000));
    expect(fed.ledger.get('f7203.31')).toBe(0);
    // Total allowed S-corp loss on Schedule E Part II col (i) = -$14,000 ($10k stock + $4k debt); disallowed carryover = $11,000 (line 35e)
    expect(fed.ledger.get('f7203.47e')).toBe(dollars(11_000));
    expect(fed.ledger.get('schE.31')).toBe(dollars(14_000));
    expect(fed.ledger.get('schE.32')).toBe(-dollars(14_000));
    expect(fed.ledger.get('sch1.5')).toBe(-dollars(14_000));
  });

  it('computes Maryland Form 500DM decoupling modifications and flows code l (addition) or code bb (subtraction) to Form 502', () => {
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(120_000) })],
      mdDecoupling: {
        federalDepreciation: dollars(40_000),
        mdDepreciationWithoutDecoupling: dollars(15_000), // $25,000 positive difference -> MD addition code 'l' on Form 502 line 5
      },
    });
    const fed = computeFederal(f);
    const md = computeMaryland(f, fed);
    expect(md.needsForm500DM).toBe(true);
    expect(md.ledger.get('md500dm.1.c1')).toBe(dollars(40_000));
    expect(md.ledger.get('md500dm.1.c2')).toBe(dollars(15_000));
    expect(md.ledger.get('md500dm.1.c3')).toBe(dollars(25_000));
    // Positive Col 3 on line 1 flows to MD Form 502 line 5 (Other additions, code 'l') -> increases MD AGI (line 7)
    expect(md.ledger.get('md502.5')).toBe(dollars(25_000));
    expect(md.ledger.get('md502.7')).toBe(dollars(145_000));

    // Now test negative difference (subsequent year where MD depreciation exceeds federal) -> MD subtraction code 'bb' on Form 502SU / Form 502 line 13
    const fSub = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(120_000) })],
      mdDecoupling: {
        federalDepreciation: dollars(5_000),
        mdDepreciationWithoutDecoupling: dollars(12_000), // -$7,000 difference -> MD subtraction code 'bb' on Form 502SU line bb / Form 502 line 13
      },
    });
    const fedSub = computeFederal(fSub);
    const mdSub = computeMaryland(fSub, fedSub);
    expect(mdSub.needsForm500DM).toBe(true);
    expect(mdSub.needsForm502SU).toBe(true);
    expect(fedSub.ledger.get('md500dm.1.c3')).toBe(-dollars(7_000));
    expect(fedSub.ledger.get('md502su.bb')).toBe(dollars(7_000));
    expect(fedSub.ledger.get('md502.13')).toBe(dollars(7_000));
  });
});
