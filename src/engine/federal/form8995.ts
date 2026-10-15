import { mulDivToDollar, pct, rateToDollar, roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';

/** One qualified trade or business (a Schedule C, a K-1 activity, or a rental that is a §199A trade or business). */
export interface QbiBusiness {
  name: string;
  /** EIN or SSN, digits only. */
  tin: string;
  /** Specified service trade or business (§199A(d)(2)). */
  isSstb: boolean;
  /** Qualified business income or (loss), whole dollars. */
  qbi: Cents;
  /** Allocable share of W-2 wages. */
  w2Wages: Cents;
  /** Allocable share of UBIA of qualified property. */
  ubia: Cents;
  /** Materially participates (§469(h)); only the 2026+ $400 minimum deduction uses it. */
  active: boolean;
  /** The Schedule C business, K-1 or rental this came from. */
  sourceId?: string;
}

/** A column of Form 8995-A Parts I–III (or a row of Form 8995 line 1). */
export interface QbiColumn {
  letter: 'A' | 'B' | 'C' | 'D' | 'E';
  name: string;
  tin: string;
  isSstb: boolean;
}

export interface Form8995Result {
  /** Form 1040 line 13a. */
  deduction: Cents;
  /** Which form is attached (`null` when there is no QBI, REIT dividend or carryforward). */
  form: 'f8995' | 'f8995a' | null;
  /** Schedule A (Form 8995-A): an SSTB in the phase-in range. */
  needsScheduleA: boolean;
  /** Schedule C (Form 8995-A): a business loss or a loss carryforward to net. */
  needsScheduleC: boolean;
  /** Form 8995 line 1 rows, or Form 8995-A columns, in print order. */
  columns: QbiColumn[];
  /** Schedule A (Form 8995-A) columns (the SSTBs among `columns`). */
  scheduleAColumns: QbiColumn[];
  /** Printed percentages on Form 8995-A line 24 and Schedule A lines 9-10. */
  printed: { phaseInPct: string; scheduleALine9: string; scheduleALine10: string };
  /** More businesses than the form's rows (5 on Form 8995, 3 on Form 8995-A). Blocks export. */
  tooManyBusinesses: boolean;
  /** Carryforwards to next year (positive magnitudes). */
  carryforwardTo2026: { qbiLoss: Cents; reitPtpLoss: Cents };
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
const PCT50 = pct('50');
const PCT25 = pct('25');
const PCT2_5 = pct('2.5');

/** num/den as a percentage with two decimals ("33.33"), rounded half up. */
function percentText(num: Cents, den: Cents): string {
  if (den === 0) return '';
  const hundredths = Number((BigInt(num) * 10_000n * 2n + BigInt(den)) / (2n * BigInt(den)));
  return (hundredths / 100).toFixed(2);
}

/** num/den as a decimal with four places ("0.3333"), rounded half up. */
function ratioText(num: Cents, den: Cents): string {
  if (den === 0) return '';
  const tenThousandths = Number((BigInt(num) * 10_000n * 2n + BigInt(den)) / (2n * BigInt(den)));
  return (tenThousandths / 10_000).toFixed(4);
}

/** Split `total` (≥ 0) across `weights` (≥ 0) in proportion, rounded to dollars, summing exactly to `total`. */
export function apportion(total: Cents, weights: Cents[]): Cents[] {
  const sum = sumCents(weights);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const shares = weights.map((w) => mulDivToDollar(total, w, sum));
  const drift = total - sumCents(shares);
  if (drift !== 0) {
    // Put the rounding difference on the largest weight so the column always ties to the total.
    let at = 0;
    weights.forEach((w, k) => {
      if (w > weights[at]!) at = k;
    });
    shares[at] = shares[at]! + drift;
  }
  return shares;
}

/** Qualified REIT dividends: 1099-DIV box 5 plus Section 199A REIT dividends passed through on K-1s. */
export function qualifiedReitDividends(f: TaxFacts): Cents {
  return (
    sumCents(f.f1099Div.map((d) => roundToDollar(d.box5Section199aDividends))) +
    sumCents((f.k1s ?? []).map((k) => roundToDollar(k.qbiReitDividends ?? 0)))
  );
}

/** Form 8995 (at or below the threshold) or Form 8995-A with Schedules A and C (above it), 2025 and 2026.
 *  Each trade or business is computed separately (no aggregation election, no cooperative patrons, no PTPs).
 *  Every fraction is an exact rational rounded once, so the phase-in range never produces fractional cents. */
export function computeForm8995(
  f: TaxFacts,
  i: {
    /** Form 1040 line 11a minus lines 12e and 13b. */
    taxableIncomeBeforeQbi: Cents;
    /** Qualified dividends plus net capital gain (Form 1040 line 3a + smaller of Schedule D line 15 or 16, if positive). */
    netCapitalGainAndQualifiedDividends: Cents;
    businesses: QbiBusiness[];
  },
  p: FedParams,
  l: Ledger,
): Form8995Result {
  const reitDividends = qualifiedReitDividends(f);
  const qbiLossCarry = Math.max(0, roundToDollar(f.carryovers?.qbiLoss ?? 0));
  const reitLossCarry = Math.max(0, roundToDollar(f.carryovers?.reitPtpLoss ?? 0));
  const businesses = i.businesses.filter((b) => b.qbi !== 0);
  const none: Form8995Result = {
    deduction: 0,
    form: null,
    needsScheduleA: false,
    needsScheduleC: false,
    columns: [],
    scheduleAColumns: [],
    printed: { phaseInPct: '', scheduleALine9: '', scheduleALine10: '' },
    tooManyBusinesses: false,
    carryforwardTo2026: { qbiLoss: 0, reitPtpLoss: 0 },
  };
  if (businesses.length === 0 && reitDividends === 0 && qbiLossCarry === 0 && reitLossCarry === 0) return none;

  const ti = i.taxableIncomeBeforeQbi;
  const threshold = p.qbi.threshold[f.filingStatus];
  const phaseIn = p.qbi.phaseInRange[f.filingStatus];
  const columnsOf = (bs: QbiBusiness[]): QbiColumn[] =>
    bs.slice(0, LETTERS.length).map((b, k) => ({ letter: LETTERS[k]!, name: b.name, tin: b.tin, isSstb: b.isSstb }));

  // REIT dividends / PTP: no wage limit and no SSTB rule at any income (§199A(b)(1)(B)).
  const netReit = reitDividends - reitLossCarry;
  const reitBase = Math.max(0, netReit);
  const reitComponent = rateToDollar(reitBase, p.qbi.rate);
  const reitLossNextYear = netReit < 0 ? -netReit : 0;

  const tiLessCapGain = Math.max(0, ti - i.netCapitalGainAndQualifiedDividends);
  const incomeLimit = rateToDollar(tiLessCapGain, p.qbi.rate);

  /** 2026+ §199A(i): at least the minimum when active QBI reaches the floor (OBBBA §70105). */
  const withMinimum = (deduction: Cents): Cents => {
    const min = p.qbi.minimumDeduction;
    if (min <= 0) return deduction;
    const activeQbi = sumCents(businesses.filter((b) => b.active).map((b) => b.qbi));
    return activeQbi >= p.qbi.minimumDeductionActiveQbi ? Math.max(deduction, min) : deduction;
  };

  if (ti <= threshold) {
    // ---- Form 8995, Qualified Business Income Deduction Simplified Computation ----
    businesses.slice(0, 5).forEach((b, k) => {
      l.set(`f8995.1c.${k}`, b.qbi, `Qualified business income or (loss): ${b.name}`);
    });
    const L2 = l.set('f8995.2', sumCents(businesses.map((b) => b.qbi)), 'Total qualified business income or (loss)', 'Line 1, column (c)');
    l.set('f8995.3', qbiLossCarry, 'Qualified business net (loss) carryforward from the prior year');
    const L4 = l.set('f8995.4', Math.max(0, L2 - qbiLossCarry), 'Total qualified business income', 'Line 2 + line 3 (if zero or less, 0)');
    const L5 = l.set('f8995.5', rateToDollar(L4, p.qbi.rate), 'Qualified business income component', 'Line 4 × 20%');
    l.set('f8995.6', reitDividends, 'Qualified REIT dividends and publicly traded partnership (PTP) income');
    l.set('f8995.7', reitLossCarry, 'Qualified REIT dividends and PTP (loss) carryforward from the prior year');
    l.set('f8995.8', reitBase, 'Total qualified REIT dividends and PTP income', 'Line 6 + line 7 (if zero or less, 0)');
    const L9 = l.set('f8995.9', reitComponent, 'REIT and PTP component', 'Line 8 × 20%');
    const L10 = l.set('f8995.10', L5 + L9, 'Qualified business income deduction before the income limitation', 'Line 5 + line 9');
    l.set('f8995.11', ti, 'Taxable income before qualified business income deduction');
    l.set('f8995.12', i.netCapitalGainAndQualifiedDividends, 'Net capital gain plus qualified dividends');
    l.set('f8995.13', tiLessCapGain, 'Line 11 minus line 12 (if zero or less, 0)');
    l.set('f8995.14', incomeLimit, 'Income limitation', 'Line 13 × 20%');
    const L15 = l.set(
      'f8995.15',
      withMinimum(Math.min(L10, incomeLimit)),
      'Qualified business income deduction',
      'Smaller of line 10 or line 14',
    );
    const qbiLossNextYear = Math.max(0, qbiLossCarry - L2);
    l.set('f8995.16', qbiLossNextYear, 'Total qualified business (loss) carryforward');
    l.set('f8995.17', reitLossNextYear, 'Total qualified REIT dividends and PTP (loss) carryforward');
    return {
      ...none,
      deduction: L15,
      form: 'f8995',
      columns: columnsOf(businesses),
      tooManyBusinesses: businesses.length > 5,
      carryforwardTo2026: { qbiLoss: qbiLossNextYear, reitPtpLoss: reitLossNextYear },
    };
  }

  // ---- Form 8995-A (taxable income above the threshold) ----
  const over = ti - threshold; // > 0
  const inPhaseIn = over < phaseIn;
  const remaining = phaseIn - over;

  // Schedule A: an SSTB counts only by its applicable percentage inside the phase-in range, and not at all above it.
  const qualified = businesses.filter((b) => !b.isSstb || inPhaseIn);
  const shown = qualified.slice(0, 3);
  const columns = columnsOf(shown);
  const adjusted = shown.map((b) => ({ ...b }));
  const needsScheduleA = adjusted.some((b) => b.isSstb);
  const scheduleAColumns: QbiColumn[] = [];
  if (needsScheduleA) {
    l.set('f8995aSchA.5', ti, 'Taxable income before qualified business income deduction');
    l.set('f8995aSchA.6', threshold, 'Threshold');
    l.set('f8995aSchA.7', over, 'Line 5 − line 6');
    l.set('f8995aSchA.8', phaseIn, 'Phase-in range');
    adjusted.forEach((b, k) => {
      if (!b.isSstb) return;
      const col = LETTERS[scheduleAColumns.length]!;
      scheduleAColumns.push({ ...columns[k]!, letter: col });
      l.set(`f8995aSchA.2.${col}`, b.qbi, `Qualified business income or (loss): ${b.name}`);
      l.set(`f8995aSchA.3.${col}`, b.w2Wages, `W-2 wages: ${b.name}`);
      l.set(`f8995aSchA.4.${col}`, b.ubia, `UBIA of qualified property: ${b.name}`);
      b.qbi = l.set(
        `f8995aSchA.11.${col}`,
        mulDivToDollar(b.qbi, remaining, phaseIn),
        `Applicable percentage of QBI: ${b.name}`,
        'Line 2 × line 10',
      );
      b.w2Wages = l.set(
        `f8995aSchA.12.${col}`,
        mulDivToDollar(b.w2Wages, remaining, phaseIn),
        `Applicable percentage of W-2 wages: ${b.name}`,
        'Line 3 × line 10',
      );
      b.ubia = l.set(
        `f8995aSchA.13.${col}`,
        mulDivToDollar(b.ubia, remaining, phaseIn),
        `Applicable percentage of UBIA: ${b.name}`,
        'Line 4 × line 10',
      );
    });
  }

  // Schedule C: losses (and the loss carryforward) offset the businesses with income, in proportion to that income.
  const anyLoss = adjusted.some((b) => b.qbi < 0) || qbiLossCarry > 0;
  const lineTwo = adjusted.map((b) => b.qbi);
  let qbiLossNextYear = 0;
  if (anyLoss) {
    adjusted.forEach((b, k) => l.set(`f8995aSchC.1a.${k}`, b.qbi, `Qualified business income or (loss): ${b.name}`));
    l.set('f8995aSchC.2', qbiLossCarry, 'Qualified business net (loss) carryforward from prior years');
    const losses = sumCents(adjusted.filter((b) => b.qbi < 0).map((b) => -b.qbi)) + qbiLossCarry;
    const L3 = l.set('f8995aSchC.3', losses, 'Total losses', 'Negative amounts on line 1, column (a), plus line 2');
    const positives = adjusted.map((b) => Math.max(0, b.qbi));
    const L4 = l.set('f8995aSchC.4', sumCents(positives), 'Total income', 'Positive amounts on line 1, column (a)');
    const L5 = l.set('f8995aSchC.5', Math.min(L3, L4), 'Losses netted with income of other businesses', 'Smaller of line 3 or line 4');
    const shares = apportion(L5, positives);
    adjusted.forEach((b, k) => {
      l.set(`f8995aSchC.1b.${k}`, shares[k]!, `Reduction for loss netting: ${b.name}`, 'Line 5 shared in proportion to income');
      lineTwo[k] = l.set(
        `f8995aSchC.1c.${k}`,
        Math.max(0, b.qbi - shares[k]!),
        `Adjusted qualified business income: ${b.name}`,
        'Column (a) − column (b), if zero or less 0',
      );
    });
    qbiLossNextYear = l.set('f8995aSchC.6', Math.max(0, L3 - L5), 'Qualified business net (loss) carryforward', 'Line 3 − line 5');
  }

  // Part II per business, with Part III's phased-in reduction when taxable income is inside the phase-in range.
  let L16 = 0;
  let phaseInPct = '';
  adjusted.forEach((b, k) => {
    const col = LETTERS[k]!;
    const L2 = l.set(`f8995a.2.${col}`, lineTwo[k]!, `Qualified business income: ${b.name}`);
    const L3 = l.set(`f8995a.3.${col}`, rateToDollar(L2, p.qbi.rate), `20% of qualified business income: ${b.name}`, 'Line 2 × 20%');
    // W-2 wages and UBIA of a business with no income left after netting don't count (8995-A instructions, lines 4 and 7).
    const L4 = l.set(`f8995a.4.${col}`, L2 > 0 ? b.w2Wages : 0, `W-2 wages: ${b.name}`);
    const L5 = l.set(`f8995a.5.${col}`, rateToDollar(L4, PCT50), '50% of W-2 wages', 'Line 4 × 50%');
    const L6 = l.set(`f8995a.6.${col}`, rateToDollar(L4, PCT25), '25% of W-2 wages', 'Line 4 × 25%');
    const L7 = l.set(`f8995a.7.${col}`, L2 > 0 ? b.ubia : 0, `UBIA of qualified property: ${b.name}`);
    const L8 = l.set(`f8995a.8.${col}`, rateToDollar(L7, PCT2_5), '2.5% of UBIA', 'Line 7 × 2.5%');
    const L9 = l.set(`f8995a.9.${col}`, L6 + L8, 'Line 6 + line 8');
    const L10 = l.set(`f8995a.10.${col}`, Math.max(L5, L9), 'Greater of line 5 or line 9');
    const L11 = l.set(`f8995a.11.${col}`, Math.min(L3, L10), 'W-2 wage and UBIA limitation', 'Smaller of line 3 or line 10');
    let L12 = 0;
    if (inPhaseIn && L10 < L3) {
      const L17 = l.set(`f8995a.17.${col}`, L3, 'Amount from line 3');
      const L18 = l.set(`f8995a.18.${col}`, L10, 'Amount from line 10');
      const L19 = l.set(`f8995a.19.${col}`, L17 - L18, 'Line 17 − line 18');
      l.set('f8995a.20', ti, 'Taxable income before qualified business income deduction');
      l.set('f8995a.21', threshold, 'Threshold');
      l.set('f8995a.22', over, 'Line 20 − line 21');
      l.set('f8995a.23', phaseIn, 'Phase-in range');
      phaseInPct = percentText(over, phaseIn);
      const L25 = l.set(`f8995a.25.${col}`, mulDivToDollar(L19, over, phaseIn), 'Total phase-in reduction', 'Line 19 × line 24');
      L12 = l.set(`f8995a.26.${col}`, L17 - L25, 'Qualified business income after phase-in reduction', 'Line 17 − line 25');
    }
    l.set(`f8995a.12.${col}`, L12, 'Phased-in reduction (line 26)');
    const L13 = l.set(`f8995a.13.${col}`, Math.max(L11, L12), 'QBI deduction before patron reduction', 'Greater of line 11 or line 12');
    l.set(`f8995a.14.${col}`, 0, 'Patron reduction');
    L16 += l.set(`f8995a.15.${col}`, L13, `Qualified business income component: ${b.name}`, 'Line 13 − line 14');
  });
  if (adjusted.length > 0) l.set('f8995a.16', L16, 'Total qualified business income component', 'Line 15, all columns');

  const L27 = l.set('f8995a.27', L16, 'Total qualified business income component from all qualified trades or businesses');
  l.set('f8995a.28', reitDividends, 'Qualified REIT dividends and publicly traded partnership (PTP) income');
  l.set('f8995a.29', reitLossCarry, 'Qualified REIT dividends and PTP (loss) carryforward from prior years');
  l.set('f8995a.30', reitBase, 'Total qualified REIT dividends and PTP income', 'Line 28 + line 29 (if zero or less, 0)');
  const L31 = l.set('f8995a.31', reitComponent, 'REIT and PTP component', 'Line 30 × 20%');
  const L32 = l.set('f8995a.32', L27 + L31, 'Qualified business income deduction before the income limitation', 'Line 27 + line 31');
  l.set('f8995a.33', ti, 'Taxable income before qualified business income deduction');
  l.set('f8995a.34', i.netCapitalGainAndQualifiedDividends, 'Net capital gain plus qualified dividends');
  l.set('f8995a.35', tiLessCapGain, 'Line 33 − line 34 (if zero or less, 0)');
  l.set('f8995a.36', incomeLimit, 'Income limitation', 'Line 35 × 20%');
  const L37 = l.set(
    'f8995a.37',
    Math.min(L32, incomeLimit),
    'Qualified business income deduction before DPAD',
    'Smaller of line 32 or line 36',
  );
  const L38 = l.set('f8995a.38', 0, 'DPAD under section 199A(g)');
  const L39 = l.set('f8995a.39', withMinimum(L37 + L38), 'Total qualified business income deduction', 'Line 37 + line 38');
  l.set('f8995a.40', reitLossNextYear, 'Total qualified REIT dividends and PTP (loss) carryforward');

  return {
    deduction: L39,
    form: 'f8995a',
    needsScheduleA,
    needsScheduleC: anyLoss,
    columns,
    scheduleAColumns,
    printed: {
      phaseInPct,
      scheduleALine9: needsScheduleA ? ratioText(over, phaseIn) : '',
      scheduleALine10: needsScheduleA ? percentText(remaining, phaseIn) : '',
    },
    tooManyBusinesses: qualified.length > 3,
    carryforwardTo2026: { qbiLoss: qbiLossNextYear, reitPtpLoss: reitLossNextYear },
  };
}
