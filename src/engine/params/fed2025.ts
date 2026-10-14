import { pct, usd, type Cents } from '../money';
import type { ScheduleRow } from '../schedule';
import type { FilingStatus } from '../../shared/facts';

export type ByStatus<T> = Record<FilingStatus, T>;

/** Build schedule rows from (over $, base $, rate %) triples copied from the official table. */
export const rows = (...r: [over: number, base: number, rate: string][]): ScheduleRow[] =>
  r.map(([over, base, rate]) => ({ over: usd(over), base: usd(base), rate: pct(rate) }));

const MFJ = rows(
  [0, 0, '10'],
  [23_850, 2_385, '12'],
  [96_950, 11_157, '22'],
  [206_700, 35_302, '24'],
  [394_600, 80_398, '32'],
  [501_050, 114_462, '35'],
  [751_600, 202_154.5, '37'],
);
const SINGLE = rows(
  [0, 0, '10'],
  [11_925, 1_192.5, '12'],
  [48_475, 5_578.5, '22'],
  [103_350, 17_651, '24'],
  [197_300, 40_199, '32'],
  [250_525, 57_231, '35'],
  [626_350, 188_769.75, '37'],
);
const MFS = rows(
  [0, 0, '10'],
  [11_925, 1_192.5, '12'],
  [48_475, 5_578.5, '22'],
  [103_350, 17_651, '24'],
  [197_300, 40_199, '32'],
  [250_525, 57_231, '35'],
  [375_800, 101_077.25, '37'],
);
const HOH = rows(
  [0, 0, '10'],
  [17_000, 1_700, '12'],
  [64_850, 7_442, '22'],
  [103_350, 15_912, '24'],
  [197_300, 38_460, '32'],
  [250_500, 55_484, '35'],
  [626_350, 187_031.5, '37'],
);

const byStatus = <T>(single: T, mfj: T, mfs: T, hoh: T, qss: T): ByStatus<T> => ({ single, mfj, mfs, hoh, qss });

/** Tax year 2025 federal parameters.
 *  Sources: Rev. Proc. 2024-40 (brackets, capital gains, AMT); Form 1040 (2025) p.2 (standard deduction after OBBBA);
 *  Schedule A (2025) instructions, State and Local Tax Deduction Worksheet; Forms 8959/8960 (2025). */
export const FED_2025 = {
  taxYear: 2025 as 2025 | 2026,
  schedules: byStatus(SINGLE, MFJ, MFS, HOH, MFJ),
  standardDeduction: byStatus(usd(15_750), usd(31_500), usd(15_750), usd(23_625), usd(31_500)),
  additionalStandardDeduction65OrBlind: {
    singleOrHoh: usd(2_000),
    marriedOrQss: usd(1_600),
  },
  /** OBBBA (2025) Schedule 1-A Part V — Enhanced Deduction for Seniors (Form 1040 line 13b). */
  seniorDeduction: {
    amountPerPerson: usd(6_000),
    phaseOutRate: pct('6'),
    phaseOutStart: byStatus(usd(75_000), usd(150_000), 0, usd(75_000), usd(75_000)),
  },
  /** Social Security Benefits Worksheet (2025 Form 1040 instructions, lines 6a–6b). */
  socialSecurityBenefits: {
    baseThreshold: byStatus(usd(25_000), usd(32_000), 0, usd(25_000), usd(25_000)),
    upperThreshold: byStatus(usd(34_000), usd(44_000), 0, usd(34_000), usd(34_000)),
    max50Slice: byStatus(usd(4_500), usd(6_000), 0, usd(4_500), usd(4_500)),
    rate50: pct('50'),
    rate85: pct('85'),
  },
  psoMaxExclusion: usd(3_000),
  capitalGains: {
    zeroRateMax: byStatus(usd(48_350), usd(96_700), usd(48_350), usd(64_750), usd(96_700)),
    fifteenRateMax: byStatus(usd(533_400), usd(600_050), usd(300_000), usd(566_700), usd(600_050)),
    rate15: pct('15'),
    rate20: pct('20'),
    rate25: pct('25'),
    rate28: pct('28'),
    capitalLossLimit: byStatus(usd(3_000), usd(3_000), usd(1_500), usd(3_000), usd(3_000)),
  },
  /** Form 8995 / 8995-A (2025) — Qualified Business Income / Section 199A REIT Dividends Deduction. */
  qbi: {
    rate: pct('20'),
    threshold: byStatus(usd(197_300), usd(394_600), usd(197_300), usd(197_300), usd(197_300)),
    phaseInRange: byStatus(usd(50_000), usd(100_000), usd(50_000), usd(50_000), usd(50_000)),
  },
  /** Schedule SE, Schedule C home office, SEP-IRA, and Form 7206 self-employed parameters (2025). */
  selfEmployment: {
    netEarningsFactor: pct('92.35'),
    minNetEarnings: usd(400),
    ssRate: pct('12.4'),
    medicareRate: pct('2.9'),
    deductibleHalfRate: pct('50'),
    sepMaxContribution: usd(70_000),
    sepEffectiveRate: pct('20'), // 25% of (net SE - 1/2 SE tax - SEP) = 20% of (net SE - 1/2 SE tax)
    homeOfficeSimplifiedRatePerSqFt: usd(5),
    homeOfficeSimplifiedMaxSqFt: 300,
    homeOfficeDefaultDeprRate: pct('2.564'), // 39-year nonresidential real property
    longTermCareAgeLimits: {
      age40OrYounger: usd(480),
      age41To50: usd(900),
      age51To60: usd(1_800),
      age61To70: usd(4_810),
      age71OrOlder: usd(6_020),
    },
  },
  salt: {
    cap: usd(40_000),
    noLimitAtOrBelow: usd(10_000),
    noLimitAtOrBelowMfs: usd(5_000),
    floor: usd(10_000),
    magiThreshold: usd(500_000),
    magiThresholdMfs: usd(250_000),
    phaseDownRate: pct('30'),
  },
  /** OBBBA (2025 vs 2026) charitable and itemized deduction rules. */
  charitable: {
    /** 2026+ above-the-line / non-itemizer cash charitable deduction cap (§70424: $1,000 single/MFS/HOH, $2,000 MFJ/QSS; $0 in 2025). */
    nonItemizerCap: byStatus(usd(0), usd(0), usd(0), usd(0), usd(0)),
    /** 2026+ floor on itemized charitable gifts as a rate of AGI (§70425(a): 0.5% in 2026, 0% in 2025). */
    itemizedFloorRate: pct('0'),
  },
  /** 2026+ limit on the value of itemized deductions for the 37% bracket (§70111: 2/37 reduction above the 37% bracket threshold; 0 in 2025). */
  itemizedTopBracketLimit: {
    enabled: false as boolean,
    bracket37Start: byStatus(usd(626_350), usd(751_600), usd(375_800), usd(626_350), usd(751_600)),
  },
  niit: { rate: pct('3.8'), threshold: byStatus(usd(200_000), usd(250_000), usd(125_000), usd(200_000), usd(250_000)) },
  additionalMedicare: {
    rate: pct('0.9'),
    regularRate: pct('1.45'),
    threshold: byStatus(usd(200_000), usd(250_000), usd(125_000), usd(200_000), usd(200_000)),
  },
  socialSecurity: { wageBase: usd(176_100), employeeRate: pct('6.2') },
  /** Rev. Proc. 2024-40 §.11 and Form 6251 (2025) line 5 / line 7. */
  amt: {
    exemption: byStatus(usd(88_100), usd(137_000), usd(68_500), usd(88_100), usd(137_000)),
    phaseOutStart: byStatus(usd(626_350), usd(1_252_700), usd(626_350), usd(626_350), usd(1_252_700)),
    phaseOutRate: pct('25'),
    rate28Threshold: byStatus(usd(239_100), usd(239_100), usd(119_550), usd(239_100), usd(239_100)),
    rate26: pct('26'),
    rate28: pct('28'),
  },
  medicalFloorRate: pct('7.5'),
  scheduleBThreshold: usd(1_500),
  /** Below this taxable income the IRS Tax Table (midpoint method) must be used. */
  taxTableLimit: usd(100_000),
} as const;

export type FedParams = typeof FED_2025;
export type { Cents };
