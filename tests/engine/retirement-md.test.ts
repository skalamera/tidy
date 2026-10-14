import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { usd } from '../../src/engine/money';
import { facts, r1099, ssa1099, w2 } from '../fixtures/facts';

const $ = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / 100]));

describe('A1 Maryland engine: 65+/blind exemptions, Worksheet 13A pension exclusion, SS subtraction, 502R, and Senior Tax Credit', () => {
  it('computes Worksheet 13A per spouse, excludes IRAs from the pension exclusion, subtracts taxable SS on line 11, and attaches 502R', () => {
    const f = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-04-10', blind: false },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1957-08-20', blind: true },
      f1099R: [
        // Taxpayer: $35,000 qualifying employer pension + $10,000 traditional IRA (IRA does NOT qualify for MD pension exclusion!)
        r1099({
          owner: 'taxpayer',
          payerName: 'Employer 401k',
          iraSepSimple: false,
          box1GrossDistribution: usd(35_000),
          box2aTaxableAmount: usd(35_000),
          stateLines: [{ state: 'MD', stateTax: usd(1_500), stateDistribution: usd(35_000) }],
        }),
        r1099({
          owner: 'taxpayer',
          payerName: 'Traditional IRA',
          iraSepSimple: true,
          box1GrossDistribution: usd(10_000),
          box2aTaxableAmount: usd(10_000),
          stateLines: [{ state: 'MD', stateTax: usd(500), stateDistribution: usd(10_000) }],
        }),
        // Spouse: $50,000 qualifying employer pension
        r1099({
          owner: 'spouse',
          payerName: 'Teacher Pension',
          iraSepSimple: false,
          box1GrossDistribution: usd(50_000),
          box2aTaxableAmount: usd(50_000),
          stateLines: [{ state: 'MD', stateTax: usd(2_500), stateDistribution: usd(50_000) }],
        }),
      ],
      ssa1099: [
        // Taxpayer: $15,000 net SS -> max exclusion ($41,200 - $15,000) = $26,200; smaller of $35,000 or $26,200 = $26,200
        ssa1099({ owner: 'taxpayer', box5NetBenefits: usd(15_000) }),
        // Spouse: $20,000 net SS -> max exclusion ($41,200 - $20,000) = $21,200; smaller of $50,000 or $21,200 = $21,200
        ssa1099({ owner: 'spouse', box5NetBenefits: usd(20_000) }),
      ],
    });
    const fed = computeFederal(f);
    const md = computeMd(f, fed);

    expect($(md.ledger.toRecord('md502.'))).toMatchObject({
      'md502.1d': 95_000, // total taxable pensions, IRAs, annuities ($35k + $10k + $50k)
      'md502.10a': 47_400, // $26,200 (you) + $21,200 (spouse)
      'md502.11': fed.ledger.get('f1040.6b') / 100, // 100% of federal taxable SS subtracted on line 11
      'md502.B': 3_000, // 2 age65 + 1 blind = 3 * $1,000
      'md502.24': 1_750, // MFJ both 65+ with FAGI <= $150,000 -> $1,750 Senior Tax Credit
      'md502.41': 4_500, // 1099-R MD withholding ($1,500 + $500 + $2,500)
    });
    expect(md.pensionExclusion).toEqual({ you: true, spouse: true });
    expect(md.exemptions).toMatchObject({ you: true, spouse: true, age65: 2, blind: 1, extra: 3 });

    // Form 502R lines
    expect($(md.ledger.toRecord('md502r.'))).toMatchObject({
      'md502r.1a': 35_000,
      'md502r.1b': 50_000,
      'md502r.7a': 10_000,
      'md502r.7b': 0,
      'md502r.8': 95_000,
      'md502r.9a': 15_000,
      'md502r.9b': 20_000,
      'md502r.10a': 15_000,
      'md502r.10b': 20_000,
      'md502r.11a': 26_200,
      'md502r.11b': 21_200,
    });
    expect(md.forms).toEqual(expect.arrayContaining(['md502', 'md502r', 'md502cr']));
  });

  it('allows pension exclusion for an under-65 totally disabled taxpayer and computes Two-Income Subtraction (Worksheet 13D) after 10a and 11', () => {
    const f = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1970-01-01', totallyDisabled: true },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1972-01-01' },
      w2s: [w2({ owner: 'spouse', box1Wages: usd(60_000) })],
      f1099R: [r1099({ owner: 'taxpayer', box1GrossDistribution: usd(20_000), box2aTaxableAmount: usd(20_000) })],
    });
    const md = computeMd(f, computeFederal(f));
    // Taxpayer is totally disabled -> gets $20,000 pension exclusion on line 10a
    expect(md.ledger.get('md502.10a')).toBe(usd(20_000));
    expect(md.pensionExclusion).toEqual({ you: true, spouse: false });
    // Taxpayer's net MD income after subtracting $20,000 pension exclusion is $0 -> two-income subtraction is $0!
    expect(md.ledger.get('md502.14')).toBe(0);
  });

  it('applies Senior Tax Credit (502CR Part M) thresholds and amounts accurately', () => {
    // 1. Single 65+, FAGI $80,000 <= $100,000 -> $1,000 credit
    const singleOk = computeMd(
      facts({
        filingStatus: 'single',
        taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
        w2s: [w2({ box1Wages: usd(80_000) })],
      }),
      computeFederal(
        facts({
          filingStatus: 'single',
          taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
          w2s: [w2({ box1Wages: usd(80_000) })],
        }),
      ),
    );
    expect(singleOk.ledger.get('md502.24')).toBe(usd(1_000));
    expect(singleOk.forms).toContain('md502cr');

    // 2. MFJ only ONE spouse 65+, FAGI $140,000 <= $150,000 -> $1,000 credit (not $1,750)
    const mfjOne65F = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1970-01-01' },
      w2s: [w2({ box1Wages: usd(140_000) })],
    });
    const mfjOne65 = computeMd(mfjOne65F, computeFederal(mfjOne65F));
    expect(mfjOne65.ledger.get('md502.24')).toBe(usd(1_000));

    // 3. MFJ both 65+, FAGI $160,000 > $150,000 -> $0 credit
    const mfjOverF = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01' },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1956-01-01' },
      w2s: [w2({ box1Wages: usd(160_000) })],
    });
    const mfjOver = computeMd(mfjOverF, computeFederal(mfjOverF));
    expect(mfjOver.ledger.get('md502.24')).toBe(0);
    expect(mfjOver.forms).not.toContain('md502cr');
  });
});
