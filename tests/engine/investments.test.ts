import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { div1099, facts, w2 } from '../fixtures/facts';
import type { CapitalLot, Form1099B, TaxFacts } from '../../src/shared/facts';

const baseFacts = (p: Partial<TaxFacts> = {}) =>
  facts({
    filingStatus: 'mfj',
    spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-02-02' },
    ...p,
  });

function lot(overrides: Partial<CapitalLot> = {}): CapitalLot {
  return {
    description: '100 sh. ACME',
    dateAcquired: '01/15/2024',
    dateSold: '06/20/2025',
    proceeds: usd(15_000),
    costBasis: usd(10_000),
    marketDiscount: 0,
    washSaleDisallowed: 0,
    box: 'D',
    ...overrides,
  };
}

function b1099(lots: CapitalLot[], overrides: Partial<Form1099B> = {}): Form1099B {
  return {
    id: 'b-1',
    owner: 'taxpayer',
    payerName: 'Vanguard Brokerage',
    box4FedWithheld: 0,
    lots,
    evidence: {},
    ...overrides,
  };
}

describe('Milestone A2 — Form 8949, Schedule D, Capital Loss Carryover, Schedule D Tax Worksheet, and Form 8995/8995-A', () => {
  it('uses the Schedule D line 1a / 8a exception when covered lots (boxes A and D) have no adjustments', () => {
    const f = baseFacts({
      w2s: [w2({ box1Wages: usd(120_000), box2FedWithheld: usd(15_000) })],
      f1099B: [
        b1099([
          lot({
            description: '50 sh. MSFT',
            box: 'A',
            dateAcquired: '03/01/2025',
            dateSold: '08/01/2025',
            proceeds: usd(8_000),
            costBasis: usd(6_500),
          }),
          lot({
            description: '100 sh. AAPL',
            box: 'D',
            dateAcquired: '01/10/2022',
            dateSold: '09/15/2025',
            proceeds: usd(25_000),
            costBasis: usd(15_000),
          }),
        ]),
      ],
    });
    const res = computeFederal(f);
    const l = res.ledger;
    // Line 1a: $8,000 - $6,500 = $1,500 short-term gain
    expect(l.get('schD.1a.d')).toBe(usd(8_000));
    expect(l.get('schD.1a.e')).toBe(usd(6_500));
    expect(l.get('schD.1a.h')).toBe(usd(1_500));
    expect(l.get('schD.1b.h')).toBe(0);
    expect(l.get('schD.7')).toBe(usd(1_500));
    // Line 8a: $25,000 - $15,000 = $10,000 long-term gain
    expect(l.get('schD.8a.d')).toBe(usd(25_000));
    expect(l.get('schD.8a.e')).toBe(usd(15_000));
    expect(l.get('schD.8a.h')).toBe(usd(10_000));
    expect(l.get('schD.15')).toBe(usd(10_000));
    // Line 16 -> 1040 line 7a = $11,500
    expect(l.get('schD.16')).toBe(usd(11_500));
    expect(l.get('f1040.7a')).toBe(usd(11_500));
    // Schedule D is required, but Form 8949 is NOT required when all lots use 1a/8a!
    expect(res.forms).toContain('schD');
    expect(res.forms).not.toContain('f8949');
    expect(res.form8949Sheets).toHaveLength(0);
  });

  it('routes wash sales, market discount, and noncovered lots (B/E) through Form 8949 and Schedule D lines 1b, 2, 8b, 9', () => {
    const f = baseFacts({
      w2s: [w2({ box1Wages: usd(100_000) })],
      f1099B: [
        b1099(
          [
            // Box A lot with a $500 wash sale disallowed -> goes on Form 8949 Box A (code W, +$500 adjustment)
            lot({
              description: '100 sh. TSLA',
              box: 'A',
              proceeds: usd(9_000),
              costBasis: usd(10_000),
              washSaleDisallowed: usd(500),
            }),
            // Box B noncovered short-term lot -> goes on Form 8949 Box B
            lot({
              description: '50 sh. NVDA',
              box: 'B',
              proceeds: usd(12_000),
              costBasis: usd(10_000),
            }),
            // Box E noncovered long-term lot with $200 market discount -> Form 8949 Box E (code M, -$200 capital gain adjustment + $200 taxable interest)
            lot({
              description: '10 T-Bond',
              box: 'E',
              proceeds: usd(10_500),
              costBasis: usd(10_000),
              marketDiscount: usd(200),
            }),
          ],
          { box4FedWithheld: usd(300) },
        ),
      ],
    });
    const res = computeFederal(f);
    const l = res.ledger;
    // Box A: proceeds $9,000, basis $10,000, adj +$500 -> gain/loss -$500
    expect(l.get('schD.1b.d')).toBe(usd(9_000));
    expect(l.get('schD.1b.e')).toBe(usd(10_000));
    expect(l.get('schD.1b.g')).toBe(usd(500));
    expect(l.get('schD.1b.h')).toBe(usd(-500));
    // Box B: proceeds $12,000, basis $10,000 -> gain +$2,000
    expect(l.get('schD.2.h')).toBe(usd(2_000));
    expect(l.get('schD.7')).toBe(usd(1_500));
    // Box E: proceeds $10,500, basis $10,000, adj -$200 (code M) -> capital gain +$300
    expect(l.get('schD.9.d')).toBe(usd(10_500));
    expect(l.get('schD.9.e')).toBe(usd(10_000));
    expect(l.get('schD.9.g')).toBe(usd(-200));
    expect(l.get('schD.9.h')).toBe(usd(300));
    // Accrued market discount ($200) is reported on Schedule B / Form 1040 line 2b as taxable interest
    expect(l.get('f1040.2b')).toBe(usd(200));
    // 1099-B federal tax withheld flows to Form 1040 line 25b
    expect(l.get('f1040.25b')).toBe(usd(300));
    expect(res.forms).toContain('f8949');
    expect(res.forms).toContain('schD');
  });

  it('paginates Form 8949 when a box has more than 11 lots', () => {
    const lots = Array.from({ length: 15 }, (_, i) =>
      lot({ description: `Lot ${i + 1}`, box: 'B', proceeds: usd(1_100), costBasis: usd(1_000) }),
    );
    const f = baseFacts({ f1099B: [b1099(lots)] });
    const res = computeFederal(f);
    expect(res.form8949Sheets).toHaveLength(2);
    expect(res.form8949Sheets[0].part1?.lots).toHaveLength(11);
    expect(res.form8949Sheets[0].part1?.totals.gainOrLoss).toBe(usd(1_100));
    expect(res.form8949Sheets[1].part1?.lots).toHaveLength(4);
    expect(res.form8949Sheets[1].part1?.totals.gainOrLoss).toBe(usd(400));
    expect(res.ledger.get('schD.2.h')).toBe(usd(1_500));
  });

  it('caps net capital losses at $3,000 ($1,500 MFS) and computes the 2025 Capital Loss Carryover Worksheet to 2026', () => {
    const f = baseFacts({
      w2s: [w2({ box1Wages: usd(100_000) })],
      carryovers: {
        capitalLossShortTerm: usd(2_000),
        capitalLossLongTerm: usd(4_000),
        qbiLoss: 0,
        reitPtpLoss: 0,
      },
      f1099B: [
        b1099([
          lot({ box: 'A', proceeds: usd(5_000), costBasis: usd(8_000) }), // -$3,000 ST
          lot({ box: 'D', proceeds: usd(10_000), costBasis: usd(16_000) }), // -$6,000 LT
        ]),
      ],
    });
    const res = computeFederal(f);
    const l = res.ledger;
    // ST: -$3,000 - $2,000 carryover = -$5,000 (line 7)
    expect(l.get('schD.6')).toBe(usd(2_000));
    expect(l.get('schD.7')).toBe(usd(-5_000));
    // LT: -$6,000 - $4,000 carryover = -$10,000 (line 15)
    expect(l.get('schD.14')).toBe(usd(4_000));
    expect(l.get('schD.15')).toBe(usd(-10_000));
    // Line 16: -$15,000; Line 21: -$3,000 -> Form 1040 line 7a = -$3,000
    expect(l.get('schD.16')).toBe(usd(-15_000));
    expect(l.get('schD.21')).toBe(usd(-3_000));
    expect(l.get('f1040.7a')).toBe(usd(-3_000));
    // Carryover to 2026: $3,000 loss used against ordinary income comes out of ST first -> ST carryover = $2,000, LT carryover = $10,000
    expect(res.capitalLossCarryoverTo2026).toEqual({
      shortTerm: usd(2_000),
      longTerm: usd(10_000),
    });
    // MFS cap is $1,500
    const mfsRes = computeFederal({ ...f, filingStatus: 'mfs', spouse: null });
    expect(mfsRes.ledger.get('f1040.7a')).toBe(usd(-1_500));
  });

  it('uses the Schedule D Tax Worksheet when there is unrecaptured Section 1250 gain (25%) or 28% rate gain', () => {
    const f = baseFacts({
      w2s: [w2({ box1Wages: usd(250_000) })],
      f1099Div: [
        div1099({
          box1aOrdinaryDividends: usd(5_000),
          box1bQualifiedDividends: usd(5_000),
          box2aCapitalGainDistributions: usd(30_000),
          box2bUnrecaptured1250Gain: usd(10_000),
          box2d28RateGain: usd(4_000),
        }),
      ],
    });
    const res = computeFederal(f);
    const l = res.ledger;
    expect(l.get('schD.18')).toBe(usd(4_000));
    expect(l.get('schD.19')).toBe(usd(10_000));
    // Compare against a return with identical capital gains ($30,000) but $0 1250/28% gain (which gets 15% on all $35,000):
    const plain = computeFederal(
      baseFacts({
        w2s: [w2({ box1Wages: usd(250_000) })],
        f1099Div: [
          div1099({
            box1aOrdinaryDividends: usd(5_000),
            box1bQualifiedDividends: usd(5_000),
            box2aCapitalGainDistributions: usd(30_000),
          }),
        ],
      }),
    );
    // In the 24% ordinary bracket ($253,500 taxable income), the $10,000 unrecaptured 1250 gain and $4,000 28% gain are taxed at 24% instead of 15%
    // Difference = $14,000 * (24% - 15%) = $1,260
    expect(res.totalTax - plain.totalTax).toBe(usd(1_260));
  });

  it('computes the 20% Section 199A REIT dividend deduction on Form 8995 (below threshold) and Form 8995-A (above threshold)', () => {
    // 1. Below MFJ threshold ($394,600): uses Form 8995
    const below = computeFederal(
      baseFacts({
        w2s: [w2({ box1Wages: usd(150_000) })],
        f1099Div: [div1099({ box1aOrdinaryDividends: usd(10_000), box5Section199aDividends: usd(10_000) })],
      }),
    );
    expect(below.ledger.get('f8995.6')).toBe(usd(10_000));
    expect(below.ledger.get('f8995.9')).toBe(usd(2_000));
    expect(below.ledger.get('f8995.15')).toBe(usd(2_000));
    expect(below.ledger.get('f1040.13a')).toBe(usd(2_000));
    expect(below.forms).toContain('f8995');
    expect(below.forms).not.toContain('f8995a');

    // 2. Above MFJ threshold ($394,600): Section 199A REIT dividends have NO W-2/UBIA limit and use Form 8995-A Part IV
    const above = computeFederal(
      baseFacts({
        w2s: [w2({ box1Wages: usd(500_000) })],
        f1099Div: [div1099({ box1aOrdinaryDividends: usd(10_000), box5Section199aDividends: usd(10_000) })],
      }),
    );
    expect(above.ledger.get('f8995a.28')).toBe(usd(10_000));
    expect(above.ledger.get('f8995a.31')).toBe(usd(2_000));
    expect(above.ledger.get('f8995a.39')).toBe(usd(2_000));
    expect(above.ledger.get('f1040.13a')).toBe(usd(2_000));
    expect(above.forms).toContain('f8995a');
    expect(above.forms).not.toContain('f8995');
  });

  it('integrates Schedule D gains/losses with Form 8960 (NIIT) and Maryland Form 502 / 502CG', () => {
    const f = baseFacts({
      w2s: [w2({ box1Wages: usd(360_000), stateLines: [{ state: 'MD', stateWages: usd(360_000), stateTax: usd(20_000) }] })],
      f1099B: [b1099([lot({ box: 'D', proceeds: usd(60_000), costBasis: usd(20_000) })])], // +$40,000 LT gain
    });
    const fed = computeFederal(f);
    expect(fed.ledger.get('f8960.5a')).toBe(usd(40_000));
    const md = computeMd(f, fed);
    expect(md.ledger.get('md502.1c')).toBe(usd(40_000));
    expect(md.ledger.get('md502.20a')).toBe(usd(40_000));
    expect(md.ledger.get('md502.21b')).toBe(usd(800)); // 2% of $40,000
    expect(md.forms).toContain('md502cg');
  });
});
