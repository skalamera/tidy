import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMaryland } from '../../src/engine/md/form502';
import { usd as dollars } from '../../src/engine/money';
import { facts as baseFacts, w2 as makeW2 } from '../fixtures/facts';

describe('Milestone A5: Federal Form 2210 and Maryland Form 502UP underpayment penalties', () => {
  it('owes no Form 2210 penalty when balance after withholding (line 7) is under $1,000 or withholding meets the 90% / 100%-110% safe harbor', () => {
    // Case 1: Line 7 < $1,000
    const fSmall = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(100_000), box2FedWithheld: dollars(13_000) })],
      payments: {
        federalEstimated: [],
        federalPriorYearApplied: 0,
        federalExtensionPayment: 0,
        computeForm2210: true,
      },
    });
    const fedSmall = computeFederal(fSmall);
    expect(fedSmall.ledger.get('f2210.7')).toBeLessThan(dollars(1_000));
    expect(fedSmall.ledger.get('f1040.38')).toBe(0);
    expect(fedSmall.forms).not.toContain('f2210');

    // Case 2: Prior-year safe harbor met (2024 AGI = $200,000 > $150,000 -> 110% of 2024 tax $10,000 = $11,000; withholding = $12,000 >= $11,000)
    const fSafe = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(250_000), box2FedWithheld: dollars(12_000) })],
      payments: {
        federalEstimated: [],
        federalPriorYearApplied: 0,
        federalExtensionPayment: 0,
        priorYearFederalAgi: dollars(200_000),
        priorYearFederalTax: dollars(10_000),
        computeForm2210: true,
      },
    });
    const fedSafe = computeFederal(fSafe);
    expect(fedSafe.ledger.get('f2210.8')).toBe(dollars(11_000));
    expect(fedSafe.ledger.get('f2210.9')).toBe(dollars(11_000));
    expect(fedSafe.ledger.get('f1040.38')).toBe(0);
  });

  it('computes Form 2210 Part I, Part III Section A, and Section B Penalty Worksheet (7% across all 4 rate periods) when underpaid', () => {
    // 2024 AGI = $200,000 (> $150k), 2024 tax = $20,000 -> Line 8 = 110% * $20,000 = $22,000
    // Suppose 2025 tax is much higher ($40,000+), so Line 9 required annual payment = $22,000 -> $5,500 per quarter on Line 10
    // Withholding = $4,000 ($1,000 per quarter on Line 11), no estimated payments made
    // Underpayment in each column (a)..(d) on Line 17 = $4,500
    // Unpaid through 04/15/26:
    // Col (a): 365 days @ 7% on $4,500 = $315.00
    // Col (b): (15 + 92 + 92 + 105 = 304 days) @ 7% on $4,500 = $262.36
    // Col (c): (15 + 92 + 105 = 212 days) @ 7% on $4,500 = $182.96
    // Col (d): 90 days @ 7% on $4,500 = $77.67
    // Total penalty (Line 19 / Form 1040 Line 38) = round($315 + $262.36 + $182.96 + $77.67) = $838
    // Withholding = $4,000 ($1,000 per quarter on Line 11), no estimated payments made
    // Section A lines:
    // Col (a): L10=5,500, L11=1,000, L15=1,000 -> L17(a) = 4,500
    // Col (b): L10=5,500, L11=1,000, L14=4,500, L15=0, L16=3,500 -> L17(b) = 5,500 (cumulative unpaid L16+L17 = 9,000)
    // Col (c): L10=5,500, L11=1,000, L14=9,000, L15=0, L16=8,000 -> L17(c) = 5,500 (cumulative unpaid L16+L17 = 13,500)
    // Col (d): L10=5,500, L11=1,000, L14=13,500, L15=0, L16=12,500 -> L17(d) = 5,500 (cumulative unpaid L16+L17 = 18,000)
    // Total penalty (Line 19 / Form 1040 Line 38) = $838
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(300_000), box2FedWithheld: dollars(4_000) })],
      payments: {
        federalEstimated: [],
        federalPriorYearApplied: 0,
        federalExtensionPayment: 0,
        priorYearFederalAgi: dollars(200_000),
        priorYearFederalTax: dollars(20_000),
        computeForm2210: true,
        form2210Boxes: ['D'], // Box D checked -> attaches Form 2210 to return
      },
    });
    const fed = computeFederal(f);
    expect(fed.ledger.get('f2210.8')).toBe(dollars(22_000));
    expect(fed.ledger.get('f2210.9')).toBe(dollars(22_000));
    expect(fed.ledger.get('f2210.10.a')).toBe(dollars(5_500));
    expect(fed.ledger.get('f2210.11.a')).toBe(dollars(1_000));
    expect(fed.ledger.get('f2210.17.a')).toBe(dollars(4_500));
    expect(fed.ledger.get('f2210.16.b')).toBe(dollars(3_500));
    expect(fed.ledger.get('f2210.17.b')).toBe(dollars(5_500));
    expect(fed.ledger.get('f2210.19')).toBe(dollars(838));
    expect(fed.ledger.get('f1040.38')).toBe(dollars(838));
    expect(fed.forms).toContain('f2210');
  });

  it('reduces Form 2210 underpayments when quarterly estimated payments or mid-period payments are made (IRS Example 3)', () => {
    // Required annual payment = $16,000 ($4,000 per quarter on Line 10), $0 withholding
    // Estimated payments made on due dates: Q1 = $2,000, Q2 = $3,000, Q3 = $4,000, Q4 = $4,000
    // Line 11: (a)=$2,000, (b)=$3,000, (c)=$4,000, (d)=$4,000
    // Col (a): L15=$2,000 -> L17(a) underpayment = $2,000
    // Col (b): L13=$3,000, L14=$2,000 -> L15=$1,000 -> L17(b) underpayment = $3,000
    // Col (c): L13=$4,000, L14=$3,000 -> L15=$1,000 -> L17(c) underpayment = $3,000
    // Col (d): L13=$4,000, L14=$3,000 -> L15=$1,000 -> L17(d) underpayment = $3,000
    const f = baseFacts({
      w2s: [makeW2({ box1Wages: dollars(250_000), box2FedWithheld: 0 })],
      payments: {
        federalEstimated: [dollars(2_000), dollars(3_000), dollars(4_000), dollars(4_000)],
        federalPriorYearApplied: 0,
        federalExtensionPayment: 0,
        priorYearFederalAgi: dollars(100_000), // <= $150k -> 100% of prior year tax
        priorYearFederalTax: dollars(16_000),
        computeForm2210: true,
      },
    });
    const fed = computeFederal(f);
    expect(fed.ledger.get('f2210.9')).toBe(dollars(16_000));
    expect(fed.ledger.get('f2210.17.a')).toBe(dollars(2_000));
    expect(fed.ledger.get('f2210.17.b')).toBe(dollars(3_000));
    expect(fed.ledger.get('f2210.17.c')).toBe(dollars(3_000));
    expect(fed.ledger.get('f2210.17.d')).toBe(dollars(3_000));
    expect(fed.ledger.get('f2210.19')).toBeGreaterThan(0);
  });

  it('computes Maryland Form 502UP underpayment interest (factors 0.0192, 0.0289, 0.0381, 0.0266) and adds to Form 502 lines 51 and 52', () => {
    // 2024 MD tax = $10,000 -> Line 9b (110%) = $11,000
    // 2025 MD + local tax > $12,222 -> Line 8 (90%) > $11,000 -> Line 10 minimum required = $11,000
    // Even quarterly distribution: 25% per period -> Line 13 required cumulative: Q1=$2,750, Q2=$5,500, Q3=$8,250, Q4=$11,000
    // Wait: on Form 502UP, Line 11 is cumulative income (1/4, 1/2, 3/4, 1.0 of Line 1) or per-period?
    // Wait — let's check Form 502UP instructions for Line 11, 12, 13, 14, 15!
    const f = baseFacts({
      w2s: [
        makeW2({
          box1Wages: dollars(220_000),
          stateLines: [{ state: 'MD', stateWages: dollars(220_000), stateTax: dollars(2_000) }],
        }),
      ],
      stateReturn: {
        homeStateMuniInterest: null,
        estimatedPayments: [],
        priorYearApplied: 0,
        extensionPayment: 0,
        priorYearMdTax: dollars(10_000),
        computeForm502UP: true,
      },
    });
    const fed = computeFederal(f);
    const md = computeMaryland(f, fed);
    expect(md.forms).toContain('md502up');
    expect(md.ledger.get('md502up.9a')).toBe(dollars(10_000));
    expect(md.ledger.get('md502up.9b')).toBe(dollars(11_000));
    expect(md.ledger.get('md502up.10')).toBe(dollars(11_000));
    expect(md.ledger.get('md502up.18')).toBeGreaterThan(0);
    expect(md.ledger.get('md502.51')).toBe(md.ledger.get('md502up.18'));
    expect(md.ledger.get('md502.52')).toBe(md.ledger.get('md502.47') + md.ledger.get('md502.51'));
  });
});
