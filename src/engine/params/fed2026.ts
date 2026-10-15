import { pct, usd } from '../money';
import type { FilingStatus } from '../../shared/facts';
import { rows, type ByStatus, type FedParams } from './fed2025';

const byStatus = <T>(single: T, mfj: T, mfs: T, hoh: T, qss: T): ByStatus<T> => ({ single, mfj, mfs, hoh, qss });

/** Rev. Proc. 2025-32 §4.01 Table 1 — Married Individuals Filing Joint Returns and Surviving Spouses (2026). */
const MFJ_2026 = rows(
  [0, 0, '10'],
  [24_800, 2_480, '12'],
  [100_800, 11_600, '22'],
  [211_400, 35_932, '24'],
  [403_550, 82_048, '32'],
  [512_450, 116_896, '35'],
  [768_700, 206_583.5, '37'],
);

/** Rev. Proc. 2025-32 §4.01 Table 3 — Unmarried Individuals (Single) (2026). */
const SINGLE_2026 = rows(
  [0, 0, '10'],
  [12_400, 1_240, '12'],
  [50_400, 5_800, '22'],
  [105_700, 17_966, '24'],
  [201_775, 41_024, '32'],
  [256_225, 58_448, '35'],
  [640_600, 192_979.25, '37'],
);

/** Rev. Proc. 2025-32 §4.01 Table 4 — Married Individuals Filing Separate Returns (2026). */
const MFS_2026 = rows(
  [0, 0, '10'],
  [12_400, 1_240, '12'],
  [50_400, 5_800, '22'],
  [105_700, 17_966, '24'],
  [201_775, 41_024, '32'],
  [256_225, 58_448, '35'],
  [384_350, 103_291.75, '37'],
);

/** Rev. Proc. 2025-32 §4.01 Table 2 — Heads of Households (2026). */
const HOH_2026 = rows(
  [0, 0, '10'],
  [17_700, 1_770, '12'],
  [67_450, 7_740, '22'],
  [105_700, 16_155, '24'],
  [201_750, 39_207, '32'],
  [256_200, 56_631, '35'],
  [640_600, 191_171, '37'],
);

/** Tax year 2026 federal parameters.
 *  Sources:
 *  - Rev. Proc. 2025-32 (§4.01 rate tables, §4.03 capital gains, §4.10 AMT, §4.14 standard deduction & aged/blind,
 *    §4.26 QBI thresholds & expanded $75k/$150k phase-in ranges, §4.27 long-term care premiums).
 *  - Public Law 119-21 (OBBBA):
 *    - §70120 / IRC §164(b)(7): 2026 SALT cap of $40,400 ($20,200 MFS), 30% phase-down above $505,000 MAGI ($252,500 MFS), $10,000 floor.
 *    - §70424 / IRC §170: Non-itemizer cash charitable deduction up to $1,000 ($2,000 MFJ).
 *    - §70425(a) / IRC §170(b): 0.5%-of-AGI floor on itemized charitable contributions.
 *    - §70111 / IRC §68: 2/37 reduction on itemized deductions for taxable income in the 37% bracket (capping tax benefit at 35%).
 *  - SSA / IRS 2026 retirement & payroll announcements: $184,500 Social Security wage base, $72,000 SEP-IRA limit. */
export const FED_2026: FedParams = {
  taxYear: 2026,
  schedules: byStatus(SINGLE_2026, MFJ_2026, MFS_2026, HOH_2026, MFJ_2026),
  standardDeduction: byStatus(usd(16_100), usd(32_200), usd(16_100), usd(24_150), usd(32_200)),
  additionalStandardDeduction65OrBlind: {
    singleOrHoh: usd(2_050),
    marriedOrQss: usd(1_650),
  },
  /** 2025 amounts (OBBBA §70102 and Rev. Proc. 2024-40), for the 2026 refund worksheet. */
  priorYear: {
    standardDeduction: byStatus(usd(15_750), usd(31_500), usd(15_750), usd(23_625), usd(31_500)),
    additional65OrBlind: { singleOrHoh: usd(2_000), marriedOrQss: usd(1_600) },
  },
  seniorDeduction: {
    amountPerPerson: usd(6_000),
    phaseOutRate: pct('6'),
    phaseOutStart: byStatus(usd(75_000), usd(150_000), 0, usd(75_000), usd(75_000)),
  },
  socialSecurityBenefits: {
    baseThreshold: byStatus(usd(25_000), usd(32_000), 0, usd(25_000), usd(25_000)),
    upperThreshold: byStatus(usd(34_000), usd(44_000), 0, usd(34_000), usd(34_000)),
    max50Slice: byStatus(usd(4_500), usd(6_000), 0, usd(4_500), usd(4_500)),
    rate50: pct('50'),
    rate85: pct('85'),
  },
  psoMaxExclusion: usd(3_000),
  /** Qualified charitable distributions are tax-free up to this much per IRA owner (§408(d)(8)(A); Notice 2025-67). */
  qcdLimit: usd(111_000),
  /** Schedule 1-A Parts II–IV (OBBBA §§70201–70203, 2025–2028, not indexed): tips, overtime, car loan interest. */
  schedule1A: {
    tipsCap: usd(25_000),
    overtimeCap: byStatus(usd(12_500), usd(25_000), 0, usd(12_500), usd(12_500)),
    tipsOvertimePhaseOutStart: byStatus(usd(150_000), usd(300_000), 0, usd(150_000), usd(150_000)),
    carLoanCap: usd(10_000),
    carLoanPhaseOutStart: byStatus(usd(100_000), usd(200_000), usd(100_000), usd(100_000), usd(100_000)),
  },
  capitalGains: {
    zeroRateMax: byStatus(usd(49_450), usd(98_900), usd(49_450), usd(66_200), usd(98_900)),
    fifteenRateMax: byStatus(usd(545_500), usd(613_700), usd(306_850), usd(579_600), usd(613_700)),
    rate15: pct('15'),
    rate20: pct('20'),
    rate25: pct('25'),
    rate28: pct('28'),
    capitalLossLimit: byStatus(usd(3_000), usd(3_000), usd(1_500), usd(3_000), usd(3_000)),
  },
  qbi: {
    rate: pct('20'),
    threshold: byStatus(usd(201_750), usd(403_500), usd(201_775), usd(201_750), usd(201_750)),
    phaseInRange: byStatus(usd(75_000), usd(150_000), usd(75_000), usd(75_000), usd(75_000)),
    /** §199A(i) (OBBBA §70105): at least $400 when QBI from active trades or businesses is $1,000 or more. */
    minimumDeduction: usd(400),
    minimumDeductionActiveQbi: usd(1_000),
  },
  selfEmployment: {
    netEarningsFactor: pct('92.35'),
    minNetEarnings: usd(400),
    ssRate: pct('12.4'),
    medicareRate: pct('2.9'),
    deductibleHalfRate: pct('50'),
    sepMaxContribution: usd(72_000),
    sepEffectiveRate: pct('20'),
    homeOfficeSimplifiedRatePerSqFt: usd(5),
    homeOfficeSimplifiedMaxSqFt: 300,
    homeOfficeDefaultDeprRate: pct('2.564'),
    longTermCareAgeLimits: {
      age40OrYounger: usd(500),
      age41To50: usd(930),
      age51To60: usd(1_860),
      age61To70: usd(4_960),
      age71OrOlder: usd(6_200),
    },
  },
  salt: {
    cap: usd(40_400),
    noLimitAtOrBelow: usd(10_000),
    noLimitAtOrBelowMfs: usd(5_000),
    floor: usd(10_000),
    magiThreshold: usd(505_000),
    magiThresholdMfs: usd(252_500),
    phaseDownRate: pct('30'),
  },
  charitable: {
    nonItemizerCap: byStatus(usd(1_000), usd(2_000), usd(1_000), usd(1_000), usd(2_000)),
    itemizedFloorRate: pct('0.5'),
  },
  itemizedTopBracketLimit: {
    enabled: true,
    bracket37Start: byStatus(usd(640_600), usd(768_700), usd(384_350), usd(640_600), usd(768_700)),
  },
  niit: { rate: pct('3.8'), threshold: byStatus(usd(200_000), usd(250_000), usd(125_000), usd(200_000), usd(250_000)) },
  additionalMedicare: {
    rate: pct('0.9'),
    regularRate: pct('1.45'),
    threshold: byStatus(usd(200_000), usd(250_000), usd(125_000), usd(200_000), usd(200_000)),
  },
  socialSecurity: { wageBase: usd(184_500), employeeRate: pct('6.2') },
  amt: {
    exemption: byStatus(usd(90_100), usd(140_200), usd(70_100), usd(90_100), usd(140_200)),
    phaseOutStart: byStatus(usd(500_000), usd(1_000_000), usd(500_000), usd(500_000), usd(1_000_000)),
    /** OBBBA §70107 doubled the exemption phase-out rate from 25% to 50% starting in 2026. */
    phaseOutRate: pct('50'),
    rate28Threshold: byStatus(usd(244_500), usd(244_500), usd(122_250), usd(244_500), usd(244_500)),
    rate26: pct('26'),
    rate28: pct('28'),
  },
  medicalFloorRate: pct('7.5'),
  scheduleBThreshold: usd(1_500),
  taxTableLimit: usd(100_000),
};
export type { FilingStatus };
