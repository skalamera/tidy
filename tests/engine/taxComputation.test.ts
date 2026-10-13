import { describe, expect, it } from 'vitest';
import { FED_2025 } from '../../src/engine/params/fed2025';
import { taxOnOrdinaryIncome, taxTableMidpoint } from '../../src/engine/federal/taxComputation';
import { usd } from '../../src/engine/money';
import type { FilingStatus } from '../../src/shared/facts';

const P = FED_2025;
const t = (ti: number, s: FilingStatus) => taxOnOrdinaryIncome(usd(ti), s, P) / 100;

describe('taxTableMidpoint', () => {
  it('uses the official row widths', () => {
    expect(taxTableMidpoint(usd(3))).toBe(usd(2.5));
    expect(taxTableMidpoint(usd(7))).toBe(usd(10));
    expect(taxTableMidpoint(usd(30))).toBe(usd(37.5));
    expect(taxTableMidpoint(usd(2_999))).toBe(usd(2_987.5));
    expect(taxTableMidpoint(usd(3_000))).toBe(usd(3_025));
    expect(taxTableMidpoint(usd(99_999))).toBe(usd(99_975));
  });
});

describe('taxOnOrdinaryIncome matches the 2025 Tax Table (Form 1040 instructions)', () => {
  const rows: [number, FilingStatus, number][] = [
    [3_000, 'single', 303],
    [25_300, 'single', 2_801],
    [25_300, 'mfj', 2_562],
    [25_300, 'hoh', 2_699],
    [25_200, 'single', 2_789],
    [69_250, 'single', 10_155],
    [69_250, 'mfj', 7_836],
    [69_250, 'hoh', 8_416],
    [94_000, 'mfj', 10_806],
    [99_950, 'single', 16_909],
    [99_950, 'mfj', 11_823],
    [99_950, 'hoh', 15_170],
  ];
  it.each(rows)('TI $%i %s → $%i', (ti, status, expected) => {
    expect(t(ti, status)).toBe(expected);
  });

  it('uses the rate schedule at and above $100,000', () => {
    expect(t(370_000, 'mfj')).toBe(74_494);
    expect(t(910_000, 'single')).toBe(293_720);
    expect(t(1_110_000, 'single')).toBe(367_720);
    expect(t(400_000, 'mfs')).toBe(110_031); // 101,077.25 + 37% × 24,200 = 110,031.25
  });

  it('returns 0 for zero or negative income', () => {
    expect(t(0, 'single')).toBe(0);
  });
});
