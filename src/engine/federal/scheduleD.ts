import { rateToDollar, roundToDollar, sumCents, usd, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { CapitalLot, FilingStatus, Form8949Box, TaxFacts } from '../../shared/facts';
import { taxOnOrdinaryIncome } from './taxComputation';

export interface Form8949Row {
  description: string;
  dateAcquired: string;
  dateSold: string;
  proceeds: Cents;
  costBasis: Cents;
  code: string;
  adjustment: Cents;
  gainOrLoss: Cents;
}

export interface Form8949PartPage {
  box: Form8949Box;
  lots: Form8949Row[];
  totals: {
    proceeds: Cents;
    costBasis: Cents;
    adjustment: Cents;
    gainOrLoss: Cents;
  };
}

/** One physical sheet of Form 8949 (Part I on page 1, Part II on page 2). */
export interface Form8949Sheet {
  part1: Form8949PartPage | null;
  part2: Form8949PartPage | null;
}

export interface ScheduleDCheckboxes {
  /** Top of Schedule D page 1: "Did you dispose of any investment(s) in a qualified opportunity fund?" (Tidy scope: No). */
  qofYes: boolean;
  qofNo: boolean;
  /** Line 17: "Are lines 15 and 16 both gains?" */
  line17Yes: boolean | null;
  /** Line 20: "Are lines 18 and 19 both zero or blank and are you not filing Form 4952?" */
  line20Yes: boolean | null;
  /** Line 22: "Do you have qualified dividends on Form 1040, line 3a?" */
  line22Yes: boolean | null;
}

export interface ScheduleDResult {
  /** Amount that flows to Form 1040 line 7a (either line 16 if >= 0, or line 21 as a negative number down to -$3,000 / -$1,500). */
  line7a: Cents;
  /** True if Form 1040 line 7b checkbox ("If you are not required to file Schedule D, check here") should be checked. */
  line7bCheck: boolean;
  /** True if Schedule D must be attached to the return. */
  needsScheduleD: boolean;
  /** True if at least one Form 8949 sheet must be attached. */
  needsForm8949: boolean;
  /** Paginated Form 8949 sheets (11 rows per page per Part). */
  form8949Sheets: Form8949Sheet[];
  /** Schedule D checkboxes. */
  checkboxes: ScheduleDCheckboxes;
  /** True when the Schedule D Tax Worksheet must be used instead of the Qualified Dividends and Capital Gain Tax Worksheet. */
  usesScheduleDTaxWorksheet: boolean;
  /** Net capital gain for QDCG worksheet / Form 8995 line 12: min(max(0, L15), max(0, L16)) when Schedule D is used, else L7a. */
  netCapitalGain: Cents;
  /** Total accrued market discount from 1099-B lots (reported on Schedule B / Form 1040 line 2b as taxable interest). */
  accruedMarketDiscountInterest: Cents;
}

/** Normalize one CapitalLot into a rounded Form 8949 row and tell whether it needs Form 8949 or can use the Schedule D line 1a / 8a exception. */
export function normalizeLot(lot: CapitalLot): { row: Form8949Row; hasAdjustment: boolean } {
  const proceeds = roundToDollar(lot.proceeds);
  const costBasis = roundToDollar(lot.costBasis);
  const wash = roundToDollar(lot.washSaleDisallowed);
  const discount = roundToDollar(lot.marketDiscount);

  let code = (lot.adjustmentCode ?? '').trim().toUpperCase();
  let adjustment: Cents;
  if (lot.adjustmentAmount !== undefined) {
    adjustment = roundToDollar(lot.adjustmentAmount);
  } else {
    adjustment = wash - discount;
  }

  if (!code) {
    const codes: string[] = [];
    if (wash !== 0) codes.push('W');
    if (discount !== 0) codes.push('M');
    code = codes.join('');
  }

  const gainOrLoss = proceeds - costBasis + adjustment;
  const hasAdjustment = code.length > 0 || adjustment !== 0 || Boolean(lot.collectibles);
  return {
    row: {
      description: lot.description,
      dateAcquired: lot.dateAcquired ?? 'VARIOUS',
      dateSold: lot.dateSold ?? 'VARIOUS',
      proceeds,
      costBasis,
      code,
      adjustment,
      gainOrLoss,
    },
    hasAdjustment,
  };
}

function paginatePart(box: Form8949Box, rows: Form8949Row[]): Form8949PartPage[] {
  const pages: Form8949PartPage[] = [];
  for (let i = 0; i < rows.length; i += 11) {
    const slice = rows.slice(i, i + 11);
    pages.push({
      box,
      lots: slice,
      totals: {
        proceeds: sumCents(slice.map((r) => r.proceeds)),
        costBasis: sumCents(slice.map((r) => r.costBasis)),
        adjustment: sumCents(slice.map((r) => r.adjustment)),
        gainOrLoss: sumCents(slice.map((r) => r.gainOrLoss)),
      },
    });
  }
  return pages;
}

/** Compute Form 8949 and Schedule D (Parts I, II, and III, including lines 18 and 19). */
export function computeScheduleD(f: TaxFacts, qualifiedDividends: Cents, p: FedParams, l: Ledger): ScheduleDResult {
  const allLots = (f.f1099B ?? []).flatMap((b) => b.lots);
  const accruedMarketDiscountInterest = sumCents(allLots.map((lot) => roundToDollar(lot.marketDiscount)));

  const line1aRows: Form8949Row[] = [];
  const line8aRows: Form8949Row[] = [];
  const byBox: Record<Form8949Box, Form8949Row[]> = { A: [], B: [], C: [], D: [], E: [], F: [] };

  for (const raw of allLots) {
    const { row, hasAdjustment } = normalizeLot(raw);
    if (raw.box === 'A' && !hasAdjustment) {
      line1aRows.push(row);
    } else if (raw.box === 'D' && !hasAdjustment) {
      line8aRows.push(row);
    } else {
      byBox[raw.box].push(row);
    }
  }

  const part1Pages = [...paginatePart('A', byBox.A), ...paginatePart('B', byBox.B), ...paginatePart('C', byBox.C)];
  const part2Pages = [...paginatePart('D', byBox.D), ...paginatePart('E', byBox.E), ...paginatePart('F', byBox.F)];
  const sheetCount = Math.max(part1Pages.length, part2Pages.length);
  const form8949Sheets: Form8949Sheet[] = [];
  for (let i = 0; i < sheetCount; i++) {
    form8949Sheets.push({
      part1: part1Pages[i] ?? null,
      part2: part2Pages[i] ?? null,
    });
  }

  const setRowTotals = (prefix: string, label: string, rows: Form8949Row[]): Cents => {
    const d = sumCents(rows.map((r) => r.proceeds));
    const e = sumCents(rows.map((r) => r.costBasis));
    const g = sumCents(rows.map((r) => r.adjustment));
    const h = sumCents(rows.map((r) => r.gainOrLoss));
    l.set(`${prefix}.d`, d, `${label} — proceeds`);
    l.set(`${prefix}.e`, e, `${label} — cost or other basis`);
    if (!prefix.endsWith('1a') && !prefix.endsWith('8a')) {
      l.set(`${prefix}.g`, g, `${label} — adjustments`);
    }
    return l.set(`${prefix}.h`, h, `${label} — gain or (loss)`);
  };

  // Part I — Short-Term
  const L1a = setRowTotals('schD.1a', 'Short-term totals directly from Form 1099-B (box A, no adjustments)', line1aRows);
  const L1b = setRowTotals('schD.1b', 'Short-term from Form 8949 Box A', byBox.A);
  const L2 = setRowTotals('schD.2', 'Short-term from Form 8949 Box B', byBox.B);
  const L3 = setRowTotals('schD.3', 'Short-term from Form 8949 Box C', byBox.C);
  const L4 = l.set('schD.4', 0, 'Short-term gain from Form 6252 / 4684 / 6781 / 8824');
  const L5 = l.set('schD.5', 0, 'Net short-term gain or (loss) from Schedules K-1');
  const stCarryover = Math.max(0, roundToDollar(f.carryovers?.capitalLossShortTerm ?? 0));
  const L6 = l.set('schD.6', stCarryover, 'Short-term capital loss carryover from 2024');
  const L7 = l.set('schD.7', L1a + L1b + L2 + L3 + L4 + L5 - L6, 'Net short-term capital gain or (loss)', 'Lines 1a through 5 − line 6');

  // Part II — Long-Term
  const L8a = setRowTotals('schD.8a', 'Long-term totals directly from Form 1099-B (box D, no adjustments)', line8aRows);
  const L8b = setRowTotals('schD.8b', 'Long-term from Form 8949 Box D', byBox.D);
  const L9 = setRowTotals('schD.9', 'Long-term from Form 8949 Box E', byBox.E);
  const L10 = setRowTotals('schD.10', 'Long-term from Form 8949 Box F', byBox.F);
  const L11 = l.set('schD.11', 0, 'Gain from Form 4797, Part I; long-term gain from Forms 2439 and 6252');
  const L12 = l.set('schD.12', 0, 'Net long-term gain or (loss) from Schedules K-1');
  const capGainDists = sumCents(f.f1099Div.map((d) => roundToDollar(d.box2aCapitalGainDistributions)));
  const L13 = l.set('schD.13', capGainDists, 'Capital gain distributions (Form 1099-DIV, box 2a)');
  const ltCarryover = Math.max(0, roundToDollar(f.carryovers?.capitalLossLongTerm ?? 0));
  const L14 = l.set('schD.14', ltCarryover, 'Long-term capital loss carryover from 2024');
  const L15 = l.set(
    'schD.15',
    L8a + L8b + L9 + L10 + L11 + L12 + L13 - L14,
    'Net long-term capital gain or (loss)',
    'Lines 8a through 13 − line 14',
  );

  // Part III — Summary
  const L16 = l.set('schD.16', L7 + L15, 'Combined net short-term and long-term capital gain or (loss)', 'Line 7 + line 15');

  const unrecaptured1250Div = sumCents(f.f1099Div.map((d) => roundToDollar(d.box2bUnrecaptured1250Gain)));
  const rate28Div = sumCents(f.f1099Div.map((d) => roundToDollar(d.box2d28RateGain)));
  const collectiblesLots = sumCents(
    allLots.filter((lot) => lot.collectibles && ['D', 'E', 'F'].includes(lot.box)).map((lot) => normalizeLot(lot).row.gainOrLoss),
  );

  const line17Yes = L15 > 0 && L16 > 0;
  let L18 = 0;
  let L19 = 0;
  if (line17Yes) {
    // 28% Rate Gain Worksheet (Schedule D instructions, line 18):
    // Collectibles gains/losses + 1099-DIV box 2d, offset by long-term carryover (line 14) and any net short-term loss (line 7 < 0).
    const raw28 = collectiblesLots + rate28Div;
    if (raw28 > 0) {
      const offset = ltCarryover + (L7 < 0 ? -L7 : 0);
      L18 = Math.max(0, raw28 - offset);
    }
    // Unrecaptured Section 1250 Gain Worksheet (Schedule D instructions, line 19):
    // 1099-DIV box 2b reduced by any net loss on the 28% rate gain worksheet.
    if (unrecaptured1250Div > 0) {
      const net28WithCarry = collectiblesLots + rate28Div - ltCarryover - (L7 < 0 ? -L7 : 0);
      const lossOffset = net28WithCarry < 0 ? -net28WithCarry : 0;
      L19 = Math.max(0, unrecaptured1250Div - lossOffset);
    }
  }
  l.set('schD.18', L18, '28% rate gain');
  l.set('schD.19', L19, 'Unrecaptured section 1250 gain');

  let L21 = 0;
  if (L16 < 0) {
    const cap = p.capitalGains.capitalLossLimit[f.filingStatus];
    L21 = -Math.min(-L16, cap);
  }
  l.set('schD.21', L21, 'Deductible capital loss');

  // Schedule D exception (Form 1040 instructions for line 7):
  // If the ONLY capital gain/loss items are 1099-DIV box 2a capital gain distributions AND boxes 2b/2d are 0,
  // the taxpayer can check box 7b on Form 1040 and omit Schedule D.
  const hasOnlySimpleCapGainDists =
    allLots.length === 0 && stCarryover === 0 && ltCarryover === 0 && unrecaptured1250Div === 0 && rate28Div === 0;
  const needsScheduleD = !hasOnlySimpleCapGainDists;
  const line7bCheck = hasOnlySimpleCapGainDists && capGainDists > 0;
  const needsForm8949 = form8949Sheets.length > 0;

  const line7a = L16 >= 0 ? L16 : L21;
  const usesScheduleDTaxWorksheet = line17Yes && (L18 > 0 || L19 > 0);
  const netCapitalGain = needsScheduleD ? Math.min(Math.max(0, L15), Math.max(0, L16)) : Math.max(0, line7a);

  const checkboxes: ScheduleDCheckboxes = {
    qofYes: false,
    qofNo: true,
    line17Yes,
    line20Yes: line17Yes ? L18 === 0 && L19 === 0 : null,
    line22Yes: !line17Yes ? qualifiedDividends > 0 : null,
  };

  return {
    line7a,
    line7bCheck,
    needsScheduleD,
    needsForm8949,
    form8949Sheets,
    checkboxes,
    usesScheduleDTaxWorksheet,
    netCapitalGain,
    accruedMarketDiscountInterest,
  };
}

/** 2025 Schedule D Tax Worksheet (Instructions for Schedule D, lines 1–47).
 *  Computes Form 1040 line 16 tax when Schedule D line 18 (28% rate gain) or line 19 (unrecaptured section 1250 gain, 25%) is positive. */
export function scheduleDTaxWorksheet(
  i: {
    taxableIncome: Cents; // Form 1040 line 15
    qualifiedDividends: Cents; // Form 1040 line 3a
    schD15: Cents; // Schedule D line 15
    schD16: Cents; // Schedule D line 16
    schD18: Cents; // Schedule D line 18 (28% rate gain)
    schD19: Cents; // Schedule D line 19 (unrecaptured section 1250 gain)
  },
  status: FilingStatus,
  p: FedParams,
  l: Ledger,
): Cents {
  const cg = p.capitalGains;
  const L1 = l.set('sdtw.1', i.taxableIncome, 'Taxable income (Form 1040, line 15)');
  l.set('sdtw.2', i.qualifiedDividends, 'Qualified dividends (Form 1040, line 3a)');
  const L6 = l.set('sdtw.6', i.qualifiedDividends, 'Qualified dividends after Form 4952 adjustment');
  const L7 = l.set('sdtw.7', Math.max(0, Math.min(i.schD15, i.schD16)), 'Smaller of Schedule D line 15 or line 16');
  const L9 = l.set('sdtw.9', L7, 'Net capital gain after Form 4952 adjustment');
  const L10 = l.set('sdtw.10', L6 + L9, 'Total qualified dividends and net capital gain', 'Line 6 + line 9');
  const L11 = l.set('sdtw.11', i.schD18 + i.schD19, 'Schedule D line 18 + line 19');
  const L12 = l.set('sdtw.12', Math.min(L9, L11), 'Smaller of line 9 or line 11');
  const L13 = l.set('sdtw.13', L10 - L12, '0%/15%/20% capital gain and qualified dividends', 'Line 10 − line 12');
  const L14 = l.set('sdtw.14', Math.max(0, L1 - L13), 'Taxable income minus 0%/15%/20% gain', 'Line 1 − line 13');
  const L15 = l.set('sdtw.15', cg.zeroRateMax[status], '0% capital gain ceiling');
  const L16 = l.set('sdtw.16', Math.min(L1, L15), 'Smaller of line 1 or line 15');
  const L17 = l.set('sdtw.17', Math.min(L14, L16), 'Smaller of line 14 or line 16');
  const L18 = l.set('sdtw.18', Math.max(0, L1 - L10), 'Ordinary income portion', 'Line 1 − line 10');
  const L19 = l.set(
    'sdtw.19',
    status === 'single' || status === 'mfs'
      ? Math.min(L1, usd(197_300))
      : status === 'hoh'
        ? Math.min(L1, usd(197_300))
        : Math.min(L1, usd(394_600)),
    '24% bracket ceiling (or line 1 if smaller)',
  );
  const L20 = l.set('sdtw.20', Math.min(L14, L19), 'Smaller of line 14 or line 19');
  const L21 = l.set('sdtw.21', Math.max(L18, L20), 'Larger of line 18 or line 20');
  const L22 = l.set('sdtw.22', L16 - L17, 'Amount taxed at 0%', 'Line 16 − line 17');

  let L30 = 0;
  let L33 = 0;
  let L36 = 0;
  if (L1 !== L16) {
    const L23 = l.set('sdtw.23', Math.min(L1, L13), 'Smaller of line 1 or line 13');
    const L24 = l.set('sdtw.24', L22, 'Amount from line 22');
    const L25 = l.set('sdtw.25', Math.max(0, L23 - L24), 'Line 23 − line 24');
    const L26 = l.set('sdtw.26', cg.fifteenRateMax[status], '15% capital gain ceiling');
    const L27 = l.set('sdtw.27', Math.min(L1, L26), 'Smaller of line 1 or line 26');
    const L28 = l.set('sdtw.28', L14 + L22, 'Line 14 + line 22');
    const L29 = l.set('sdtw.29', Math.max(0, L27 - L28), '15% bracket room', 'Line 27 − line 28');
    const L30val = l.set('sdtw.30', Math.min(L25, L29), 'Amount taxed at 15%');
    L30 = L30val;
    const L31 = l.set('sdtw.31', rateToDollar(L30, cg.rate15), '15% of line 30');
    const L32 = l.set('sdtw.32', L24 + L30, 'Line 24 + line 30');
    L33 = l.set('sdtw.33', L23 - L32, 'Amount taxed at 20%', 'Line 23 − line 32');
    const L34 = l.set('sdtw.34', rateToDollar(L33, cg.rate20), '20% of line 33');
    void L31;
    void L34;

    if (i.schD19 > 0) {
      const L35 = l.set('sdtw.35', Math.min(L9, i.schD19), 'Smaller of line 9 or Schedule D line 19');
      const L36a = l.set('sdtw.36', L10 + L21, 'Line 10 + line 21');
      const L38 = l.set('sdtw.38', Math.max(0, L36a - L1), 'Line 36 − line 1');
      L36 = l.set('sdtw.39', Math.max(0, L35 - L38), 'Amount taxed at 25%');
    }
  }

  const L31 = rateToDollar(L30, cg.rate15);
  const L34 = rateToDollar(L33, cg.rate20);
  const L40 = l.set('sdtw.40', rateToDollar(L36, cg.rate25), '25% of line 39');

  let L43 = 0;
  if (i.schD18 > 0) {
    const L41 = l.set('sdtw.41', L21 + L22 + L30 + L33 + L36, 'Sum of prior slices');
    const L42 = l.set('sdtw.42', Math.max(0, L1 - L41), 'Amount taxed at 28%', 'Line 1 − line 41');
    L43 = l.set('sdtw.43', rateToDollar(L42, cg.rate28), '28% of line 42');
  }

  const L44 = l.set('sdtw.44', taxOnOrdinaryIncome(L21, status, p), 'Tax on line 21');
  const L45 = l.set('sdtw.45', L31 + L34 + L40 + L43 + L44, 'Sum of worksheet taxes');
  const L46 = l.set('sdtw.46', taxOnOrdinaryIncome(L1, status, p), 'Regular tax on line 1');
  return l.set('sdtw.47', Math.min(L45, L46), 'Tax (Schedule D Tax Worksheet)');
}

/** 2025 Capital Loss Carryover Worksheet (Instructions for Schedule D, page 11) — computes carryovers from 2025 to 2026. */
export function capitalLossCarryoverTo2026(i: {
  agi: Cents; // Form 1040 line 11b
  totalDeductions: Cents; // Form 1040 line 14
  schD7: Cents; // Schedule D line 7
  schD15: Cents; // Schedule D line 15
  schD21: Cents; // Schedule D line 21 (negative or 0)
}): { shortTerm: Cents; longTerm: Cents } {
  const lossDeducted = Math.abs(i.schD21);
  if (lossDeducted === 0) return { shortTerm: 0, longTerm: 0 };

  // Line 1: Form 1040 line 11b minus line 14 (can be negative!)
  const L1 = i.agi - i.totalDeductions;
  const L2 = lossDeducted;
  const L3 = Math.max(0, L1 + L2);
  const L4 = Math.min(L2, L3);

  const stLoss = i.schD7 < 0 ? -i.schD7 : 0;
  const ltLoss = i.schD15 < 0 ? -i.schD15 : 0;

  let shortTerm = 0;
  let L7 = 0;
  if (stLoss > 0) {
    const L6 = Math.max(0, i.schD15);
    L7 = L4 + L6;
    shortTerm = Math.max(0, stLoss - L7);
  }

  let longTerm = 0;
  if (ltLoss > 0) {
    const L10 = Math.max(0, i.schD7);
    const L11 = stLoss > 0 ? Math.max(0, L7 - stLoss) : L4;
    const L12 = L10 + L11;
    longTerm = Math.max(0, ltLoss - L12);
  }

  return { shortTerm, longTerm };
}
