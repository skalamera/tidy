import { describe, expect, it } from 'vitest';
import { MD_2025 } from '../../src/engine/params/md2025';
import { mdCapitalGainSurtax, mdExemptionValue, mdItemizedPhaseOut, mdLocalTax, mdStateTax } from '../../src/engine/md/mdTax';
import { usd } from '../../src/engine/money';
import type { FilingStatus } from '../../src/shared/facts';

const $ = (c: number) => c / 100;

describe('mdStateTax (Form 502 line 21, 2025)', () => {
  const rows: [number, FilingStatus, number][] = [
    [10, 'single', 0],
    [60, 'single', 1],
    [120, 'single', 3],
    [3_010, 'single', 91],
    [6_000, 'single', 234],
    [50_020, 'single', 2_324],
    [58_800, 'single', 2_742], // rows from the 2025 MD tax table
    [400_000, 'mfj', 20_823],
    [1_100_000, 'single', 64_885],
    [1_300_000, 'mfj', 76_323], // schedules I/II
  ];
  it.each(rows)('TI $%i %s → $%i', (ti, s, expected) => {
    expect($(mdStateTax(usd(ti), s, MD_2025))).toBe(expected);
  });
});

describe('mdLocalTax (Form 502 line 28, 2025)', () => {
  it('flat counties', () => {
    expect($(mdLocalTax(usd(400_000), 'Montgomery', 'mfj', MD_2025))).toBe(12_800);
    expect($(mdLocalTax(usd(100_000), 'Worcester', 'single', MD_2025))).toBe(2_250);
  });
  it('Anne Arundel is marginal', () => {
    expect($(mdLocalTax(usd(500_000), 'Anne Arundel', 'mfj', MD_2025))).toBe(14_572);
    expect($(mdLocalTax(usd(60_000), 'Anne Arundel', 'single', MD_2025))).toBe(1_644); // 1,350 + 2.94% × 10,000
  });
  it('Frederick taxes the whole income at one tier rate', () => {
    expect($(mdLocalTax(usd(200_000), 'Frederick', 'mfj', MD_2025))).toBe(5_920);
    expect($(mdLocalTax(usd(200_000), 'Frederick', 'single', MD_2025))).toBe(6_400);
  });
});

describe('Maryland deductions and surtax', () => {
  it('exemption value follows chart 10A', () => {
    expect($(mdExemptionValue(usd(90_000), 'single', MD_2025))).toBe(3_200);
    expect($(mdExemptionValue(usd(110_000), 'single', MD_2025))).toBe(1_600);
    expect($(mdExemptionValue(usd(160_000), 'mfj', MD_2025))).toBe(1_600);
    expect($(mdExemptionValue(usd(447_000), 'mfj', MD_2025))).toBe(0);
  });
  it('itemized phase-out is 7.5% of FAGI over $200,000 ($100,000 MFS)', () => {
    expect($(mdItemizedPhaseOut(usd(250_000), 'single', MD_2025))).toBe(3_750); // Tax Alert example 1
    expect($(mdItemizedPhaseOut(usd(400_000), 'mfj', MD_2025))).toBe(15_000); // Tax Alert example 2
    expect($(mdItemizedPhaseOut(usd(150_000), 'mfs', MD_2025))).toBe(3_750);
  });
  it('2% capital gain tax only above $350,000 FAGI', () => {
    expect($(mdCapitalGainSurtax(usd(447_000), usd(5_000), MD_2025))).toBe(100);
    expect($(mdCapitalGainSurtax(usd(350_000), usd(5_000), MD_2025))).toBe(0);
  });
});
