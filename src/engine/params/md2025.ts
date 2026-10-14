import { pct, usd, type Cents, type Ppm } from '../money';
import { rows, type ByStatus } from './fed2025';
import type { ScheduleRow } from '../schedule';

const byStatus = <T>(single: T, mfj: T, mfs: T, hoh: T, qss: T): ByStatus<T> => ({ single, mfj, mfs, hoh, qss });

const SCHEDULE_I = rows(
  [0, 0, '2'],
  [1_000, 20, '3'],
  [2_000, 50, '4'],
  [3_000, 90, '4.75'],
  [100_000, 4_697.5, '5'],
  [125_000, 5_947.5, '5.25'],
  [150_000, 7_260, '5.5'],
  [250_000, 12_760, '5.75'],
  [500_000, 27_135, '6.25'],
  [1_000_000, 58_385, '6.5'],
);
const SCHEDULE_II = rows(
  [0, 0, '2'],
  [1_000, 20, '3'],
  [2_000, 50, '4'],
  [3_000, 90, '4.75'],
  [150_000, 7_072.5, '5'],
  [175_000, 8_322.5, '5.25'],
  [225_000, 10_947.5, '5.5'],
  [300_000, 15_072.5, '5.75'],
  [600_000, 32_322.5, '6.25'],
  [1_200_000, 69_822.5, '6.5'],
);

export type MdCounty =
  | 'Allegany'
  | 'Anne Arundel'
  | 'Baltimore City'
  | 'Baltimore County'
  | 'Calvert'
  | 'Caroline'
  | 'Carroll'
  | 'Cecil'
  | 'Charles'
  | 'Dorchester'
  | 'Frederick'
  | 'Garrett'
  | 'Harford'
  | 'Howard'
  | 'Kent'
  | 'Montgomery'
  | "Prince George's"
  | "Queen Anne's"
  | "St. Mary's"
  | 'Somerset'
  | 'Talbot'
  | 'Washington'
  | 'Wicomico'
  | 'Worcester';

/** Local tax rule: a flat rate, Anne Arundel's marginal brackets, or Frederick's "whole income at one rate" tiers. */
export type LocalRule =
  | { kind: 'flat'; rate: Ppm }
  | { kind: 'marginal'; schedules: { unmarried: ScheduleRow[]; joint: ScheduleRow[] } }
  | { kind: 'tiered'; tiers: { unmarried: { upTo: Cents | null; rate: Ppm }[]; joint: { upTo: Cents | null; rate: Ppm }[] } };

const flat = (r: string): LocalRule => ({ kind: 'flat', rate: pct(r) });
const tier = (upTo: number | null, r: string) => ({ upTo: upTo === null ? null : usd(upTo), rate: pct(r) });

/** 2025 LOCAL TAX RATE CHART (Maryland 2025 Resident Booklet, Instruction 19). */
export const MD_LOCAL_2025: Record<MdCounty, LocalRule> = {
  'Baltimore City': flat('3.2'),
  Allegany: flat('3.03'),
  'Baltimore County': flat('3.2'),
  Calvert: flat('3.2'),
  Caroline: flat('3.2'),
  Carroll: flat('3.03'),
  Cecil: flat('2.74'),
  Charles: flat('3.03'),
  Dorchester: flat('3.3'),
  Garrett: flat('2.65'),
  Harford: flat('3.06'),
  Howard: flat('3.2'),
  Kent: flat('3.2'),
  Montgomery: flat('3.2'),
  "Prince George's": flat('3.2'),
  "Queen Anne's": flat('3.2'),
  "St. Mary's": flat('3.2'),
  Somerset: flat('3.2'),
  Talbot: flat('2.4'),
  Washington: flat('2.95'),
  Wicomico: flat('3.2'),
  Worcester: flat('2.25'),
  'Anne Arundel': {
    kind: 'marginal',
    schedules: {
      unmarried: rows([0, 0, '2.7'], [50_000, 1_350, '2.94'], [400_000, 11_640, '3.2']),
      joint: rows([0, 0, '2.7'], [75_000, 2_025, '2.94'], [480_000, 13_932, '3.2']),
    },
  },
  Frederick: {
    kind: 'tiered',
    tiers: {
      unmarried: [tier(25_000, '2.25'), tier(50_000, '2.75'), tier(150_000, '2.96'), tier(null, '3.2')],
      joint: [tier(25_000, '2.25'), tier(100_000, '2.75'), tier(250_000, '2.96'), tier(null, '3.2')],
    },
  },
};

/** Maryland tax year 2025. Source: 2025 Resident Booklet (rate schedules I/II, exemption chart 10A,
 *  standard deduction, local tax chart) and the Dec-2025 Tax Alert (itemized phase-out, 2% capital gain tax). */
export const MD_2025 = {
  taxYear: 2025,
  schedules: byStatus<ScheduleRow[]>(SCHEDULE_I, SCHEDULE_II, SCHEDULE_I, SCHEDULE_II, SCHEDULE_II),
  /** Below this taxable net income the MD tax table (midpoint) is used. */
  taxTableLimit: usd(100_000),
  standardDeduction: byStatus(usd(3_350), usd(6_700), usd(3_350), usd(6_700), usd(6_700)),
  itemizedPhaseOut: { rate: pct('7.5'), threshold: usd(200_000), thresholdMfs: usd(100_000) },
  exemption: {
    amount: usd(3_200),
    /** Chart 10A: [FAGI over, value per exemption] — first matching row from the top wins. */
    unmarried: [
      [usd(150_000), 0],
      [usd(125_000), usd(800)],
      [usd(100_000), usd(1_600)],
    ] as [Cents, Cents][],
    joint: [
      [usd(200_000), 0],
      [usd(175_000), usd(800)],
      [usd(150_000), usd(1_600)],
    ] as [Cents, Cents][],
    ageOrBlind: usd(1_000),
  },
  /** Worksheet 13A (2025 Maryland Resident Booklet, Instruction 13) — maximum pension exclusion ($41,200 per qualifying spouse). */
  pensionExclusionMax: usd(41_200),
  /** Form 502CR Part M (2025) — Senior Tax Credit. */
  seniorTaxCredit: {
    unmarriedMaxFagi: usd(100_000),
    jointOrMfsMaxFagi: usd(150_000),
    singleAmount: usd(1_000),
    jointBoth65Amount: usd(1_750),
    mfsAmount: usd(875),
  },
  capitalGainSurtax: { rate: pct('2'), fagiThreshold: usd(350_000) },
  local: MD_LOCAL_2025,
} as const;

export type MdParams = typeof MD_2025;
