import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { S2, facts, int1099 } from '../fixtures/facts';

const dollars = (rec: Record<string, number>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v / 100]));

/** M1 — S2 living in Montgomery County, MD, with $2,000 of Treasury interest and MD withholding. */
const M1 = facts({
  ...S2,
  residency: { state: 'MD', fullYear: true, mdCounty: 'Montgomery', mdSubdivision: { code: '1600', name: 'Montgomery' } },
  w2s: S2.w2s.map((w) => ({ ...w, stateLines: w.stateLines.map((s) => ({ ...s, state: 'MD' })) })),
  f1099Int: [int1099({ box1Interest: usd(12_000), box3UsTreasuryInterest: usd(2_000), box8TaxExemptInterest: usd(3_000) })],
  stateReturn: { homeStateMuniInterest: usd(1_000), estimatedPayments: [usd(4_000)], priorYearApplied: 0, extensionPayment: 0 },
});

describe('Form 502 (2025)', () => {
  it('M1: Montgomery County, itemized with phase-out, 2% capital gain tax, U.S. obligations', () => {
    const md = computeMd(M1, computeFederal(M1));
    expect(dollars(md.ledger.toRecord('md502'))).toMatchObject({
      'md502.1': 449_000,
      'md502.1c': 5_000,
      'md502.2': 2_000,
      'md502.7': 451_000,
      'md502su.ab': 2_000,
      'md502su.hh': 0,
      'md502.13': 2_000,
      'md502.14': 1_200,
      'md502.16': 447_800,
      'md502.17a': 77_000,
      'md502.17b': 22_000,
      'md502.17c': 18_675,
      'md502.17': 36_325,
      'md502.19': 0,
      'md502.20': 411_475,
      'md502.20a': 5_000,
      'md502.21': 21_482,
      'md502.21b': 100,
      'md502.28': 13_167,
      'md502.34': 34_749,
      'md502.41': 26_000,
      'md502.43': 4_000,
      'md502.47': 4_749,
      'md502.48': 0,
    });
    expect(md.localRatePrinted).toBe('320');
    expect(md.forms).toEqual(['md502', 'md502su', 'md502cg', 'mdpv']);
  });
});
