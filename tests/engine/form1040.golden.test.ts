import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd } from '../../src/engine/money';
import { S1, S2, S3 } from '../fixtures/facts';

const dollars = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / 100]));

describe('Form 1040 golden scenarios (TY2025)', () => {
  it('S1: single W-2, standard deduction, Tax Table', () => {
    const r = computeFederal(S1);
    expect(dollars(r.ledger.toRecord('f1040.'))).toMatchObject({
      'f1040.1z': 85_000,
      'f1040.9': 85_000,
      'f1040.11b': 85_000,
      'f1040.12e': 15_750,
      'f1040.15': 69_250,
      'f1040.16': 10_155,
      'f1040.24': 10_155,
      'f1040.25d': 11_000,
      'f1040.33': 11_000,
      'f1040.34': 845,
      'f1040.37': 0,
    });
    expect(r.itemizing).toBe(false);
    expect(r.forms).toEqual(['f1040']);
  });

  it('S2: MFJ, itemized, QDCG worksheet, Additional Medicare + NIIT', () => {
    const r = computeFederal(S2);
    expect(dollars(r.ledger.toRecord())).toMatchObject({
      'f1040.1z': 400_000,
      'f1040.2a': 3_000,
      'f1040.2b': 12_000,
      'f1040.3a': 24_000,
      'f1040.3b': 30_000,
      'f1040.7a': 5_000,
      'f1040.9': 447_000,
      'f1040.11a': 447_000,
      'schA.5a': 26_000,
      'schA.5d': 44_000,
      'schA.5e': 40_000,
      'schA.17': 77_000,
      'f1040.12e': 77_000,
      'f1040.15': 370_000,
      'qdcg.5': 341_000,
      'qdcg.18': 4_350,
      'qdcg.22': 67_534,
      'qdcg.24': 74_494,
      'qdcg.25': 71_884,
      'f1040.16': 71_884,
      'f8959.7': 1_562,
      'f8959.19': 7_311,
      'f8959.21': 6_141,
      'f8959.24': 1_170,
      'f8960.8': 47_000,
      'f8960.17': 1_786,
      'sch2.21': 3_348,
      'f1040.24': 75_232,
      'f1040.25c': 1_170,
      'f1040.25d': 86_170,
      'f1040.26': 10_000,
      'f1040.33': 96_170,
      'f1040.34': 20_938,
    });
    expect(r.forms).toEqual(['f1040', 'sch2', 'schA', 'schB', 'f8959', 'f8960']);
  });

  it('S3: single $1.25M, SALT floor, 37%/20%, excess social security', () => {
    const r = computeFederal(S3);
    expect(dollars(r.ledger.toRecord())).toMatchObject({
      'f1040.9': 1_250_000,
      'schA.5d': 128_000,
      'schA.5e': 10_000,
      'schA.17': 140_000,
      'f1040.15': 1_110_000,
      'qdcg.21': 40_000,
      'qdcg.22': 293_720,
      'qdcg.25': 333_720,
      'f8959.7': 7_380,
      'f8959.24': 5_580,
      'f8960.17': 9_500,
      'sch2.21': 16_880,
      'sch3.11': 10_918,
      'f1040.24': 350_600,
      'f1040.33': 336_498,
      'f1040.37': 14_102,
    });
    expect(r.amountOwed).toBe(usd(14_102));
    expect(r.forms).toEqual(['f1040', 'sch2', 'sch3', 'schA', 'schB', 'f8959', 'f8960']);
  });
});
