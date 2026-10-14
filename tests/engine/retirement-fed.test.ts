import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd } from '../../src/engine/money';
import { facts, int1099, r1099, ssa1099, w2 } from '../fixtures/facts';

const $ = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / 100]));

describe('A1 federal engine: 65+/blind, Schedule 1-A, SSA-1099, and 1099-R', () => {
  it('adds extra standard deduction for 65+ and blind ($2,000 single/HoH, $1,600 married/QSS per box)', () => {
    const single65Blind = facts({
      filingStatus: 'single',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-05-05', blind: true },
      w2s: [w2({ box1Wages: usd(50_000) })],
    });
    const rSingle = computeFederal(single65Blind);
    // $15,750 base + 2 * $2,000 = $19,750
    expect(rSingle.ledger.get('f1040.12e')).toBe(usd(19_750));

    const mfjBoth65OneBlind = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1961-01-01', blind: true }, // Jan 1, 1961 is born before Jan 2, 1961!
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1958-10-10', blind: false },
      w2s: [w2({ box1Wages: usd(80_000) })],
    });
    const rMfj = computeFederal(mfjBoth65OneBlind);
    // $31,500 base + 3 * $1,600 = $36,300
    expect(rMfj.ledger.get('f1040.12e')).toBe(usd(36_300));
  });

  it('computes Schedule 1-A Part V Enhanced Deduction for Seniors ($6,000 per person, 6% phaseout above $75k/$150k)', () => {
    // 1. MFJ both 65+, MAGI $120,000 <= $150,000 -> full $12,000
    const full = computeFederal(
      facts({
        filingStatus: 'mfj',
        taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1956-01-01' },
        w2s: [w2({ box1Wages: usd(120_000) })],
      }),
    );
    expect($(full.ledger.toRecord('sch1A.'))).toMatchObject({
      'sch1A.1': 120_000,
      'sch1A.3': 120_000,
      'sch1A.31': 120_000,
      'sch1A.32': 150_000,
      'sch1A.33': 0,
      'sch1A.36a': 6_000,
      'sch1A.36b': 6_000,
      'sch1A.37': 12_000,
      'sch1A.38': 12_000,
    });
    expect(full.ledger.get('f1040.13b')).toBe(usd(12_000));
    expect(full.forms).toContain('sch1A');

    // 2. MFJ both 65+, MAGI $200,000 ($50,000 over $150,000) -> 6% * $50,000 = $3,000 reduction per person -> $3,000 each = $6,000 total
    const partial = computeFederal(
      facts({
        filingStatus: 'mfj',
        taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1956-01-01' },
        w2s: [w2({ box1Wages: usd(200_000) })],
      }),
    );
    expect($(partial.ledger.toRecord('sch1A.'))).toMatchObject({
      'sch1A.33': 50_000,
      'sch1A.34': 3_000,
      'sch1A.35': 3_000,
      'sch1A.36a': 3_000,
      'sch1A.36b': 3_000,
      'sch1A.37': 6_000,
      'sch1A.38': 6_000,
    });
    expect(partial.ledger.get('f1040.13b')).toBe(usd(6_000));

    // 3. Single 65+, itemizing -> still gets Schedule 1-A senior deduction!
    const itemizingSenior = computeFederal(
      facts({
        filingStatus: 'single',
        taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
        w2s: [w2({ box1Wages: usd(85_000) })], // $10,000 over $75,000 -> 6% = $600 reduction -> $5,400
        itemized: { ...facts().itemized, charityCash: usd(25_000) },
      }),
    );
    expect(itemizingSenior.itemizing).toBe(true);
    expect(itemizingSenior.ledger.get('f1040.13b')).toBe(usd(5_400));
    expect(itemizingSenior.ledger.get('f1040.14')).toBe(usd(25_000 + 5_400));

    // 4. MFS -> not eligible for senior deduction ($0)
    const mfsSenior = computeFederal(
      facts({
        filingStatus: 'mfs',
        taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1956-01-01' },
        w2s: [w2({ box1Wages: usd(40_000) })],
      }),
    );
    expect(mfsSenior.ledger.get('f1040.13b')).toBe(0);
    expect(mfsSenior.forms).not.toContain('sch1A');
  });

  it('computes Social Security Benefits Worksheet across 0%, 50%, and 85% tiers (including tax-exempt interest)', () => {
    // Tier 0: MFJ provisional income <= $32,000 -> $0 taxable
    const tier0 = computeFederal(
      facts({
        filingStatus: 'mfj',
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1958-01-01' },
        f1099R: [r1099({ box1GrossDistribution: usd(15_000), box2aTaxableAmount: usd(15_000) })],
        ssa1099: [ssa1099({ box5NetBenefits: usd(24_000), box6FedWithheld: usd(2_400) })],
      }),
    );
    // Provisional = $15,000 + 0.5 * $24,000 = $27,000 <= $32,000
    expect($(tier0.ledger.toRecord('f1040.'))).toMatchObject({
      'f1040.6a': 24_000,
      'f1040.6b': 0,
      'f1040.25b': 2_400,
    });

    // Tier 1 (up to 50%): MFJ provisional income between $32,000 and $44,000
    // Other income $22,000 + tax-exempt interest $4,000 + 0.5 * $20,000 SS = $36,000 ($4,000 over $32,000) -> 50% of $4,000 = $2,000
    const tier1 = computeFederal(
      facts({
        filingStatus: 'mfj',
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1958-01-01' },
        f1099R: [r1099({ box1GrossDistribution: usd(22_000), box2aTaxableAmount: usd(22_000) })],
        f1099Int: [int1099({ box8TaxExemptInterest: usd(4_000) })],
        ssa1099: [ssa1099({ box5NetBenefits: usd(20_000) })],
      }),
    );
    expect($(tier1.ledger.toRecord('f1040.'))).toMatchObject({
      'f1040.6a': 20_000,
      'f1040.6b': 2_000,
    });

    // Tier 2 (up to 85%): MFJ provisional income above $44,000
    // Wages $50,000 + 0.5 * $30,000 SS = $65,000 ($21,000 over $44,000)
    // Line 16 = $6,000 + 85% of $21,000 ($17,850) = $23,850
    // Line 17 = 85% of $30,000 = $25,500 -> smaller is $23,850
    const tier2 = computeFederal(
      facts({
        filingStatus: 'mfj',
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1958-01-01' },
        w2s: [w2({ box1Wages: usd(50_000) })],
        ssa1099: [ssa1099({ owner: 'taxpayer', box5NetBenefits: usd(18_000) }), ssa1099({ owner: 'spouse', box5NetBenefits: usd(12_000) })],
      }),
    );
    expect($(tier2.ledger.toRecord('f1040.'))).toMatchObject({
      'f1040.6a': 30_000,
      'f1040.6b': 23_850,
    });

    // Cap at 85% of benefits when income is high
    const capped85 = computeFederal(
      facts({
        filingStatus: 'single',
        w2s: [w2({ box1Wages: usd(100_000) })],
        ssa1099: [ssa1099({ box5NetBenefits: usd(20_000) })],
      }),
    );
    expect(capped85.ledger.get('f1040.6b')).toBe(usd(17_000));
  });

  it('routes 1099-R IRA vs pension distributions to lines 4a/4b and 5a/5b, handling rollovers, QCDs, and PSO exclusions', () => {
    const r = computeFederal(
      facts({
        filingStatus: 'mfj',
        taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1952-03-15' },
        spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1954-07-20' },
        f1099R: [
          // 1. IRA distribution of $25,000 with $5,000 QCD -> gross $25,000, taxable $20,000, QCD checked
          r1099({
            owner: 'taxpayer',
            payerName: 'Vanguard IRA',
            iraSepSimple: true,
            box1GrossDistribution: usd(25_000),
            box2aTaxableAmount: usd(25_000),
            qcdAmount: usd(5_000),
            box4FedWithheld: usd(2_000),
          }),
          // 2. Direct rollover of $40,000 (code G) -> gross $40,000, taxable $0, Rollover checked on 5c
          r1099({
            owner: 'spouse',
            payerName: 'Fidelity 401k',
            iraSepSimple: false,
            box1GrossDistribution: usd(40_000),
            box2aTaxableAmount: 0,
            box7Codes: 'G',
          }),
          // 3. Pension of $30,000 with $3,000 PSO insurance exclusion -> gross $30,000, taxable $27,000, PSO checked on 5c
          r1099({
            owner: 'taxpayer',
            payerName: 'County Retirement',
            iraSepSimple: false,
            box1GrossDistribution: usd(30_000),
            box2aTaxableAmount: usd(30_000),
            psoAmount: usd(3_000),
            box4FedWithheld: usd(3_000),
          }),
        ],
      }),
    );
    expect($(r.ledger.toRecord('f1040.'))).toMatchObject({
      'f1040.4a': 25_000,
      'f1040.4b': 20_000,
      'f1040.5a': 70_000,
      'f1040.5b': 27_000,
      'f1040.9': 47_000,
      'f1040.25b': 5_000,
    });
    expect(r.line4c).toEqual({ rollover: false, qcd: true });
    expect(r.line5c).toEqual({ rollover: true, pso: true });
  });
});
