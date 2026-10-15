import { mulDivToDollar, rateToDollar, roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { BusinessAssetDisposition, Owner, ScheduleCBusiness, TaxFacts } from '../../shared/facts';

export interface Form4797Row {
  description: string;
  dateAcquired: string;
  dateSold: string;
  salesPrice: Cents;
  depreciation: Cents;
  costBasis: Cents;
  gainOrLoss: Cents;
}

export interface Form4797Part3Col {
  description: string;
  dateAcquired: string;
  dateSold: string;
  line20SalesPrice: Cents;
  line21CostBasis: Cents;
  line22Depreciation: Cents;
  line23AdjustedBasis: Cents;
  line24TotalGain: Cents;
  line25aDepr1245: Cents;
  line25bRecapture1245: Cents;
}

export interface Form4797Result {
  needs4797: boolean;
  /** Ordinary gain or (loss) from Form 4797 line 18b -> Schedule 1 line 4. */
  schedule1Line4: Cents;
  /** Long-term §1231 capital gain from Form 4797 line 7 or 9 -> Schedule D line 11. */
  scheduleDLine11: Cents;
  /** §179 recapture from Form 4797 Part IV line 35(a) -> Schedule C line 6 (other income). */
  section179RecaptureToScheduleC: Cents;
  part1Rows: Form4797Row[];
  part2Rows: Form4797Row[];
  part3Cols: Form4797Part3Col[];
}

export interface BusinessResult {
  /** Active (non-closed-in-prior-year) Schedule C business, if any. */
  activeBusiness: ScheduleCBusiness | null;
  needsScheduleC: boolean;
  needsScheduleSE: boolean;
  needsForm8829: boolean;
  needsForm7206: boolean;
  needsForm4797: boolean;
  needsSchedule1: boolean;
  /** Schedule C line 31: net profit or (loss) (-> Schedule 1 line 3). */
  netProfitOrLoss: Cents;
  /** Schedule SE line 6: net earnings from self-employment (for Form 8959 Part II line 8). */
  seNetEarnings: Cents;
  /** Schedule SE line 12: self-employment tax (-> Schedule 2 line 4). */
  seTax: Cents;
  /** Schedule SE line 13: deductible part of self-employment tax (-> Schedule 1 line 15). */
  deductibleSeTax: Cents;
  /** Schedule 1 line 16: self-employed SEP, SIMPLE, and qualified plans. */
  sepDeduction: Cents;
  /** Form 7206 line 14: self-employed health insurance deduction (-> Schedule 1 line 17). */
  seHealthInsuranceDeduction: Cents;
  /** Schedule 1 line 10: total additional income (-> Form 1040 line 8). */
  schedule1AdditionalIncome: Cents;
  /** Schedule 1 line 26: total adjustments to income (-> Form 1040 line 10). */
  schedule1Adjustments: Cents;
  /** Mortgage interest and real estate tax already deducted on Form 8829 (subtracted from Schedule A lines 5b and 8a). */
  homeOfficeScheduleAReduction: {
    mortgageInterest: Cents;
    realEstateTax: Cents;
  };
  /** Net qualified business income (or loss) from the Schedule C trade or business after §199A adjustments (1/2 SE tax, SEP, SE health insurance). */
  netQbi: Cents;
  /** Deductible part of SE tax attributable to K-1 self-employment earnings (reduces those K-1s' QBI). */
  seTaxForK1s: Cents;
  /** Printed percentage strings for Form 8829 lines 3, 7, 41 and Form 7206 line 6. */
  printed: {
    f8829Pct3: string;
    f8829Pct7: string;
    f8829Pct41: string;
    f7206Ratio6: string;
    simplifiedTotalSqFt: string;
    simplifiedBusinessSqFt: string;
  };
  form4797: Form4797Result;
}

/** Age at end of 2025 for Form 7206 line 2 long-term care insurance limit. */
export function ageAtEndOf2025(dob: string | null | undefined): number {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 50;
  if (dob === '1961-01-01') return 65;
  const y = Number.parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? 2025 - y : 50;
}

export function ltcLimitForAge(age: number, p: FedParams): Cents {
  const lim = p.selfEmployment.longTermCareAgeLimits;
  if (age <= 40) return lim.age40OrYounger;
  if (age <= 50) return lim.age41To50;
  if (age <= 60) return lim.age51To60;
  if (age <= 70) return lim.age61To70;
  return lim.age71OrOlder;
}

/** Compute Form 4797 (Sales of Business Property) for assets sold, scrapped/abandoned, or converted to personal use, plus K-1 §1231 gains/losses. */
export function computeForm4797(
  dispositions: BusinessAssetDisposition[],
  prior1231Losses: Cents,
  l: Ledger,
  k1Net1231Gain: Cents = 0,
): Form4797Result {
  const part1Rows: Form4797Row[] = [];
  const part2Rows: Form4797Row[] = [];
  const part3Cols: Form4797Part3Col[] = [];
  let sec179PriorTotal = 0;
  let sec179RecompTotal = 0;

  if (k1Net1231Gain !== 0) {
    part1Rows.push({
      description: 'From Schedule(s) K-1',
      dateAcquired: '',
      dateSold: '',
      salesPrice: 0,
      depreciation: 0,
      costBasis: 0,
      gainOrLoss: roundToDollar(k1Net1231Gain),
    });
  }

  for (const d of dispositions) {
    const salesPrice = roundToDollar(d.salesPrice);
    const costBasis = roundToDollar(d.costBasis);
    const depr = roundToDollar(d.depreciationAllowed);
    const adjustedBasis = Math.max(0, costBasis - depr);
    const gainOrLoss = salesPrice + depr - costBasis;
    const heldLong = d.heldMoreThanOneYear ?? true;

    if (d.disposition === 'personal') {
      // Converting business property to personal use is not a sale or exchange, so no gain or loss is recognized.
      // However, if §179 was claimed in a prior year and business use dropped to 50% or less during the recovery period, Part IV recaptures excess §179.
      if ((d.section179RecapturePrior ?? 0) > 0) {
        sec179PriorTotal += roundToDollar(d.section179RecapturePrior ?? 0);
        sec179RecompTotal += roundToDollar(d.section179RecomputedDepreciation ?? 0);
      }
      continue;
    }

    if (d.disposition === 'scrapped') {
      // Abandonment / scrapping of business property for $0 produces an ordinary loss equal to remaining adjusted basis on Part II line 10.
      if (adjustedBasis > 0 || costBasis > 0) {
        part2Rows.push({
          description: `${d.description} (abandoned)`,
          dateAcquired: d.dateAcquired,
          dateSold: d.dateDisposed,
          salesPrice: 0,
          depreciation: depr,
          costBasis,
          gainOrLoss: -adjustedBasis,
        });
      }
      continue;
    }

    // d.disposition === 'sold'
    if (!heldLong) {
      part2Rows.push({
        description: d.description,
        dateAcquired: d.dateAcquired,
        dateSold: d.dateDisposed,
        salesPrice,
        depreciation: depr,
        costBasis,
        gainOrLoss,
      });
    } else if (gainOrLoss > 0 && depr > 0) {
      // Depreciable property held > 1 year sold at a gain -> Part III (§1245 / §1250 recapture)
      const recapture1245 = Math.min(gainOrLoss, depr);
      part3Cols.push({
        description: d.description,
        dateAcquired: d.dateAcquired,
        dateSold: d.dateDisposed,
        line20SalesPrice: salesPrice,
        line21CostBasis: costBasis,
        line22Depreciation: depr,
        line23AdjustedBasis: adjustedBasis,
        line24TotalGain: gainOrLoss,
        line25aDepr1245: depr,
        line25bRecapture1245: recapture1245,
      });
    } else {
      // Held > 1 year sold at a loss (or gain with 0 depreciation) -> Part I (§1231)
      part1Rows.push({
        description: d.description,
        dateAcquired: d.dateAcquired,
        dateSold: d.dateDisposed,
        salesPrice,
        depreciation: depr,
        costBasis,
        gainOrLoss,
      });
    }
  }

  const sec179Recapture = Math.max(0, sec179PriorTotal - sec179RecompTotal);
  const needs4797 = part1Rows.length > 0 || part2Rows.length > 0 || part3Cols.length > 0 || sec179Recapture > 0;
  if (!needs4797) {
    return {
      needs4797: false,
      schedule1Line4: 0,
      scheduleDLine11: 0,
      section179RecaptureToScheduleC: 0,
      part1Rows: [],
      part2Rows: [],
      part3Cols: [],
    };
  }

  // Part III (lines 30–32)
  const L30 = sumCents(part3Cols.map((c) => c.line24TotalGain));
  const L31 = sumCents(part3Cols.map((c) => c.line25bRecapture1245));
  const L32 = Math.max(0, L30 - L31);
  if (part3Cols.length > 0) {
    l.set('f4797.30', L30, 'Total gains for all properties (Form 4797, line 30)');
    l.set('f4797.31', L31, 'Ordinary recapture under section 1245 (Form 4797, line 31)');
    l.set('f4797.32', L32, 'Section 1231 gain from Part III (Form 4797, line 32)');
  }

  // Part I (lines 2–9)
  const part1RowGain = sumCents(part1Rows.map((r) => r.gainOrLoss));
  const L6 = l.set('f4797.6', L32, 'Gain from line 32');
  const L7 = l.set('f4797.7', part1RowGain + L6, 'Total section 1231 gain or (loss)');
  const L8 = roundToDollar(prior1231Losses);
  if (L8 > 0) l.set('f4797.8', L8, 'Nonrecaptured net section 1231 losses from prior years');

  let L9 = 0;
  let L11 = 0;
  let L12 = 0;
  let scheduleDLine11 = 0;
  if (L7 <= 0) {
    L11 = L7; // negative or 0
  } else if (L8 === 0) {
    scheduleDLine11 = L7;
  } else {
    L9 = Math.max(0, L7 - L8);
    l.set('f4797.9', L9, 'Line 7 minus line 8');
    if (L9 === 0) {
      L12 = L7;
    } else {
      L12 = L8;
      scheduleDLine11 = L9;
    }
  }

  // Part II (lines 10–18b)
  const part2RowGain = sumCents(part2Rows.map((r) => r.gainOrLoss));
  if (L11 !== 0) l.set('f4797.11', L11, 'Loss from line 7');
  if (L12 !== 0) l.set('f4797.12', L12, 'Gain from line 7 or line 8');
  if (L31 !== 0) l.set('f4797.13', L31, 'Gain from line 31 (ordinary recapture)');
  const L17 = l.set('f4797.17', part2RowGain + L11 + L12 + L31, 'Total ordinary gains and losses');
  const L18b = l.set('f4797.18b', L17, 'Ordinary gain or (loss) for Schedule 1, line 4');

  if (sec179Recapture > 0) {
    l.set('f4797.33a', sec179PriorTotal, 'Section 179 expense deduction allowable in prior years');
    l.set('f4797.34a', sec179RecompTotal, 'Recomputed depreciation');
    l.set('f4797.35a', sec179Recapture, 'Section 179 recapture amount');
  }

  return {
    needs4797: true,
    schedule1Line4: L18b,
    scheduleDLine11,
    section179RecaptureToScheduleC: sec179Recapture,
    part1Rows,
    part2Rows,
    part3Cols,
  };
}

/** Compute Schedule C, Form 8829 (or simplified home office), Form 4797, Schedule SE, SEP deduction, Form 7206, and Schedule 1. */
export function computeBusinessAndSchedule1(f: TaxFacts, p: FedParams, l: Ledger): BusinessResult {
  const empty4797: Form4797Result = {
    needs4797: false,
    schedule1Line4: 0,
    scheduleDLine11: 0,
    section179RecaptureToScheduleC: 0,
    part1Rows: [],
    part2Rows: [],
    part3Cols: [],
  };
  const emptyPrinted = {
    f8829Pct3: '',
    f8829Pct7: '',
    f8829Pct41: '',
    f7206Ratio6: '',
    simplifiedTotalSqFt: '',
    simplifiedBusinessSqFt: '',
  };

  const activeBiz = (f.scheduleC ?? []).find((b) => !b.closedInPriorYear) ?? null;
  const necs = f.f1099Nec ?? [];
  const k1Net1231 = sumCents((f.k1s ?? []).map((k) => roundToDollar(k.netSection1231Gain)));
  const k1SeTaxpayer = sumCents(
    (f.k1s ?? []).filter((k) => k.owner === 'taxpayer').map((k) => roundToDollar(k.selfEmploymentEarnings ?? 0)),
  );
  const k1SeSpouse = sumCents((f.k1s ?? []).filter((k) => k.owner === 'spouse').map((k) => roundToDollar(k.selfEmploymentEarnings ?? 0)));
  const k1SeTotal = k1SeTaxpayer + k1SeSpouse;
  const k1SeOwner: Owner = k1SeSpouse !== 0 && k1SeTaxpayer === 0 ? 'spouse' : 'taxpayer';

  // If no active Schedule C object was provided but 1099-NECs were uploaded, synthesize a default consulting Schedule C for the 1099-NEC owner.
  const biz: ScheduleCBusiness | null =
    activeBiz ??
    (necs.length > 0
      ? {
          id: 'schc-auto',
          owner: necs[0].owner,
          principalBusiness: 'Consulting services',
          businessCode: '541610',
          businessName: null,
          ein: null,
          isSstb: true,
          expenses: {},
        }
      : null);

  if (!biz && k1Net1231 === 0 && k1SeTotal === 0) {
    return {
      activeBusiness: null,
      needsScheduleC: false,
      needsScheduleSE: false,
      needsForm8829: false,
      needsForm7206: false,
      needsForm4797: false,
      needsSchedule1: false,
      netProfitOrLoss: 0,
      seNetEarnings: 0,
      seTax: 0,
      deductibleSeTax: 0,
      sepDeduction: 0,
      seHealthInsuranceDeduction: 0,
      schedule1AdditionalIncome: 0,
      schedule1Adjustments: 0,
      homeOfficeScheduleAReduction: { mortgageInterest: 0, realEstateTax: 0 },
      netQbi: 0,
      seTaxForK1s: 0,
      printed: emptyPrinted,
      form4797: empty4797,
    };
  }

  // 1. Form 4797 dispositions (computed first because Part IV §179 recapture flows into Schedule C line 6)
  const form4797 = computeForm4797(biz?.assetDispositions ?? [], biz?.priorSection1231Losses ?? 0, l, k1Net1231);

  if (!biz) {
    // Only K-1 §1231 and/or K-1 self-employment earnings exist (no Schedule C)
    const seRawK1 = k1SeTotal > 0 ? rateToDollar(k1SeTotal, p.selfEmployment.netEarningsFactor) : k1SeTotal;
    const needsScheduleSE = seRawK1 >= p.selfEmployment.minNetEarnings;
    let seNetEarnings = 0;
    let seTax = 0;
    let deductibleSeTax = 0;
    if (needsScheduleSE) {
      l.set('schSE.2', k1SeTotal, 'Net profit or (loss) from Schedule(s) K-1');
      l.set('schSE.3', k1SeTotal, 'Combined net earnings');
      const SE4a = l.set('schSE.4a', seRawK1, '92.35% of line 3');
      const SE4c = l.set('schSE.4c', SE4a, 'Combined net earnings from self-employment');
      const SE6 = l.set('schSE.6', SE4c, 'Net earnings from self-employment');
      seNetEarnings = SE6;
      const ownerSsWages = sumCents(f.w2s.filter((w) => w.owner === k1SeOwner).map((w) => roundToDollar(w.box3SsWages)));
      const SE8a = l.set('schSE.8a', ownerSsWages, 'Total social security wages and tips from Form(s) W-2');
      const SE8d = l.set('schSE.8d', SE8a, 'Total social security wages');
      const SE9 = l.set('schSE.9', Math.max(0, p.socialSecurity.wageBase - SE8d), 'Remaining social security wage base');
      const SE10 = l.set(
        'schSE.10',
        SE9 > 0 ? rateToDollar(Math.min(SE6, SE9), p.selfEmployment.ssRate) : 0,
        'Social security portion (12.4%)',
      );
      const SE11 = l.set('schSE.11', rateToDollar(SE6, p.selfEmployment.medicareRate), 'Medicare portion (2.9%)');
      seTax = l.set('schSE.12', SE10 + SE11, 'Self-employment tax');
      deductibleSeTax = l.set(
        'schSE.13',
        rateToDollar(seTax, p.selfEmployment.deductibleHalfRate),
        'Deduction for one-half of self-employment tax',
      );
    }
    const S1_4 = l.set('sch1.4', form4797.schedule1Line4, 'Other gains or (losses) (Form 4797)');
    const S1_10 = l.set('sch1.10', S1_4, 'Additional income');
    const S1_15 = l.set('sch1.15', deductibleSeTax, 'Deductible part of self-employment tax');
    const S1_26 = l.set('sch1.26', S1_15, 'Total adjustments to income');
    return {
      activeBusiness: null,
      needsScheduleC: false,
      needsScheduleSE,
      needsForm8829: false,
      needsForm7206: false,
      needsForm4797: form4797.needs4797,
      needsSchedule1: form4797.needs4797 || needsScheduleSE || S1_10 !== 0 || S1_26 !== 0,
      netProfitOrLoss: 0,
      seNetEarnings,
      seTax,
      deductibleSeTax,
      sepDeduction: 0,
      seHealthInsuranceDeduction: 0,
      schedule1AdditionalIncome: S1_10,
      schedule1Adjustments: S1_26,
      homeOfficeScheduleAReduction: { mortgageInterest: 0, realEstateTax: 0 },
      netQbi: 0,
      seTaxForK1s: deductibleSeTax,
      printed: emptyPrinted,
      form4797,
    };
  }

  // 2. Schedule C Part I — Income
  const ownerNecReceipts = sumCents(necs.filter((n) => n.owner === biz.owner).map((n) => roundToDollar(n.box1NonemployeeCompensation)));
  const L1 = l.set('schC.1', ownerNecReceipts + roundToDollar(biz.additionalGrossReceipts ?? 0), 'Gross receipts or sales');
  const L2 = l.set('schC.2', roundToDollar(biz.returnsAndAllowances ?? 0), 'Returns and allowances');
  const L3 = l.set('schC.3', L1 - L2, 'Net receipts', 'Line 1 − line 2');
  const L4 = l.set('schC.4', 0, 'Cost of goods sold');
  const L5 = l.set('schC.5', L3 - L4, 'Gross profit', 'Line 3 − line 4');
  const L6 = l.set('schC.6', roundToDollar(biz.otherIncome ?? 0) + form4797.section179RecaptureToScheduleC, 'Other income');
  const L7 = l.set('schC.7', L5 + L6, 'Gross income', 'Line 5 + line 6');

  // 3. Schedule C Part II — Expenses (lines 8–28)
  const e = biz.expenses;
  const setExp = (id: string, val: Cents | undefined, label: string) => l.set(id, roundToDollar(val ?? 0), label);
  const L8 = setExp('schC.8', e.advertising, 'Advertising');
  const L9 = setExp('schC.9', e.carAndTruck, 'Car and truck expenses');
  const L10 = setExp('schC.10', e.commissionsAndFees, 'Commissions and fees');
  const L11 = setExp('schC.11', e.contractLabor, 'Contract labor');
  const L12 = setExp('schC.12', e.depletion, 'Depletion');
  const L13 = setExp('schC.13', e.depreciation, 'Depreciation and section 179 expense deduction');
  const L14 = setExp('schC.14', e.employeeBenefitPrograms, 'Employee benefit programs');
  const L15 = setExp('schC.15', e.insurance, 'Insurance (other than health)');
  const L16a = setExp('schC.16a', e.interestMortgage, 'Mortgage interest (paid to banks, etc.)');
  const L16b = setExp('schC.16b', e.interestOther, 'Other interest');
  const L17 = setExp('schC.17', e.legalAndProfessional, 'Legal and professional services');
  const L18 = setExp('schC.18', e.officeExpense, 'Office expense');
  const L19 = setExp('schC.19', e.pensionAndProfitSharing, 'Pension and profit-sharing plans');
  const L20a = setExp('schC.20a', e.rentVehiclesMachinery, 'Rent or lease — vehicles, machinery, and equipment');
  const L20b = setExp('schC.20b', e.rentOtherBusinessProperty, 'Rent or lease — other business property');
  const L21 = setExp('schC.21', e.repairsAndMaintenance, 'Repairs and maintenance');
  const L22 = setExp('schC.22', e.supplies, 'Supplies');
  const L23 = setExp('schC.23', e.taxesAndLicenses, 'Taxes and licenses');
  const L24a = setExp('schC.24a', e.travel, 'Travel');
  const L24b = setExp('schC.24b', e.deductibleMeals, 'Deductible meals');
  const L25 = setExp('schC.25', e.utilities, 'Utilities');
  const L26 = setExp('schC.26', e.wages, 'Wages');
  const L27a = l.set('schC.27a', 0, 'Energy efficient commercial buildings deduction');
  const otherTotal = sumCents((biz.otherExpenses ?? []).map((x) => roundToDollar(x.amount)));
  const L48 = l.set('schC.48', otherTotal, 'Total other expenses (Part V)');
  const L27b = l.set('schC.27b', L48, 'Other expenses (from line 48)');

  const L28 = l.set(
    'schC.28',
    sumCents([
      L8,
      L9,
      L10,
      L11,
      L12,
      L13,
      L14,
      L15,
      L16a,
      L16b,
      L17,
      L18,
      L19,
      L20a,
      L20b,
      L21,
      L22,
      L23,
      L24a,
      L24b,
      L25,
      L26,
      L27a,
      L27b,
    ]),
    'Total expenses before business use of home',
  );
  const L29 = l.set('schC.29', L7 - L28, 'Tentative profit or (loss)', 'Line 7 − line 28');

  // 4. Home Office — Schedule C line 30 / Form 8829
  const printed = { ...emptyPrinted };
  let L30 = 0;
  let needsForm8829 = false;
  const homeOfficeScheduleAReduction = { mortgageInterest: 0, realEstateTax: 0 };

  if (biz.homeOffice && biz.homeOffice.businessSqFt > 0 && biz.homeOffice.totalSqFt > 0) {
    const ho = biz.homeOffice;
    if (ho.method === 'simplified') {
      const allowableSqFt = Math.min(ho.businessSqFt, p.selfEmployment.homeOfficeSimplifiedMaxSqFt);
      const rawSimplified = allowableSqFt * p.selfEmployment.homeOfficeSimplifiedRatePerSqFt;
      L30 = L29 > 0 ? Math.min(L29, rawSimplified) : 0;
      printed.simplifiedTotalSqFt = String(Math.round(ho.totalSqFt));
      printed.simplifiedBusinessSqFt = String(Math.round(ho.businessSqFt));
    } else {
      needsForm8829 = true;
      const ratio = Math.min(1, ho.businessSqFt / ho.totalSqFt);
      const pctPpm = Math.round(ratio * 1_000_000);
      const pctStr = (ratio * 100).toFixed(2);
      printed.f8829Pct3 = pctStr;
      printed.f8829Pct7 = pctStr;

      l.set('f8829.1', Math.round(ho.businessSqFt) * 100, 'Area used regularly and exclusively for business');
      l.set('f8829.2', Math.round(ho.totalSqFt) * 100, 'Total area of home');
      const H8 = l.set('f8829.8', L29, 'Tentative profit or (loss) from Schedule C, line 29');

      const H10a = l.set('f8829.10a', roundToDollar(ho.directMortgageInterest ?? 0), 'Direct deductible mortgage interest');
      const H10b = l.set(
        'f8829.10b',
        roundToDollar(ho.indirectMortgageInterest ?? f.itemized.mortgageInterest1098),
        'Indirect deductible mortgage interest',
      );
      const H11a = l.set('f8829.11a', roundToDollar(ho.directRealEstateTaxes ?? 0), 'Direct real estate taxes');
      const H11b = l.set('f8829.11b', roundToDollar(ho.indirectRealEstateTaxes ?? f.itemized.realEstateTax), 'Indirect real estate taxes');
      const H12a = l.set('f8829.12a', H10a + H11a, 'Total direct casualty, mortgage interest, and real estate taxes');
      const H12b = l.set('f8829.12b', H10b + H11b, 'Total indirect casualty, mortgage interest, and real estate taxes');
      const H13 = l.set('f8829.13', rateToDollar(H12b, pctPpm), 'Indirect mortgage interest and real estate taxes business portion');
      const H14 = l.set('f8829.14', H12a + H13, 'Total mortgage interest and real estate taxes business portion');
      const H15 = l.set('f8829.15', Math.max(0, H8 - H14), 'Gross income limit for operating expenses');

      // Reduce Schedule A mortgage interest and real estate taxes by the business portion claimed on Form 8829:
      homeOfficeScheduleAReduction.mortgageInterest = H10a + rateToDollar(H10b, pctPpm);
      homeOfficeScheduleAReduction.realEstateTax = H11a + rateToDollar(H11b, pctPpm);

      const H18a = l.set('f8829.18a', roundToDollar(ho.directInsurance ?? 0), 'Direct insurance');
      const H18b = l.set('f8829.18b', roundToDollar(ho.indirectInsurance ?? 0), 'Indirect insurance');
      const H19a = l.set('f8829.19a', roundToDollar(ho.directRent ?? 0), 'Direct rent');
      const H19b = l.set('f8829.19b', roundToDollar(ho.indirectRent ?? 0), 'Indirect rent');
      const H20a = l.set('f8829.20a', roundToDollar(ho.directRepairs ?? 0), 'Direct repairs and maintenance');
      const H20b = l.set('f8829.20b', roundToDollar(ho.indirectRepairs ?? 0), 'Indirect repairs and maintenance');
      const H21a = l.set('f8829.21a', roundToDollar(ho.directUtilities ?? 0), 'Direct utilities');
      const H21b = l.set('f8829.21b', roundToDollar(ho.indirectUtilities ?? 0), 'Indirect utilities');
      const H22a = l.set('f8829.22a', roundToDollar(ho.directOther ?? 0), 'Direct other expenses');
      const H22b = l.set('f8829.22b', roundToDollar(ho.indirectOther ?? 0), 'Indirect other expenses');

      const H23a = l.set('f8829.23a', H18a + H19a + H20a + H21a + H22a, 'Total direct operating expenses');
      const H23b = l.set('f8829.23b', H18b + H19b + H20b + H21b + H22b, 'Total indirect operating expenses');
      const H24 = l.set('f8829.24', rateToDollar(H23b, pctPpm), 'Indirect operating expenses business portion');
      const H25 = l.set('f8829.25', roundToDollar(ho.priorOperatingCarryover ?? 0), 'Carryover of prior year operating expenses');
      const H26 = l.set('f8829.26', H23a + H24 + H25, 'Total operating expenses');
      const H27 = l.set('f8829.27', Math.min(H15, H26), 'Allowable operating expenses');
      const H28 = l.set('f8829.28', Math.max(0, H15 - H27), 'Limit on excess casualty losses and depreciation');

      // Part III — Depreciation of Your Home
      const H37 = l.set('f8829.37', roundToDollar(ho.homeAdjustedBasisOrFmv ?? 0), 'Smaller of home adjusted basis or fair market value');
      const H38 = l.set('f8829.38', roundToDollar(ho.homeLandValue ?? 0), 'Value of land included on line 37');
      const H39 = l.set('f8829.39', Math.max(0, H37 - H38), 'Basis of building');
      const H40 = l.set('f8829.40', rateToDollar(H39, pctPpm), 'Business basis of building');
      const deprRate = ho.homeDepreciationRatePpm ?? p.selfEmployment.homeOfficeDefaultDeprRate;
      printed.f8829Pct41 = H40 > 0 ? (deprRate / 10_000).toFixed(3) : '';
      const H42 = l.set('f8829.42', rateToDollar(H40, deprRate), 'Depreciation allowable');

      const H30 = l.set('f8829.30', H42, 'Depreciation of your home from line 42');
      const H31 = l.set('f8829.31', roundToDollar(ho.priorDepreciationCarryover ?? 0), 'Carryover of prior year depreciation');
      const H32 = l.set('f8829.32', H30 + H31, 'Total depreciation');
      const H33 = l.set('f8829.33', Math.min(H28, H32), 'Allowable depreciation');
      const H34 = l.set('f8829.34', H14 + H27 + H33, 'Total allowable home office expenses');
      const H36 = l.set('f8829.36', H34, 'Allowable expenses for business use of your home');

      l.set('f8829.43', Math.max(0, H26 - H27), 'Carryover of unallowed operating expenses to 2026');
      l.set('f8829.44', Math.max(0, H32 - H33), 'Carryover of unallowed depreciation to 2026');
      L30 = H36;
    }
  }

  l.set('schC.30', L30, 'Expenses for business use of your home');
  const L31 = l.set('schC.31', L29 - L30, 'Net profit or (loss)', 'Line 29 − line 30');

  // 5. Schedule SE — Self-Employment Tax
  const combinedSeInput = L31 + k1SeTotal;
  const seRaw = combinedSeInput > 0 ? rateToDollar(combinedSeInput, p.selfEmployment.netEarningsFactor) : combinedSeInput;
  const needsScheduleSE = seRaw >= p.selfEmployment.minNetEarnings;
  let seNetEarnings = 0;
  let seTax = 0;
  let deductibleSeTax = 0;

  if (needsScheduleSE) {
    l.set('schSE.2', combinedSeInput, 'Net profit or (loss) from Schedule C, line 31 and Schedule(s) K-1');
    l.set('schSE.3', combinedSeInput, 'Combined net earnings');
    const SE4a = l.set('schSE.4a', seRaw, '92.35% of line 3');
    const SE4c = l.set('schSE.4c', SE4a, 'Combined net earnings from self-employment');
    const SE6 = l.set('schSE.6', SE4c, 'Net earnings from self-employment');
    seNetEarnings = SE6;

    const ownerSsWages = sumCents(f.w2s.filter((w) => w.owner === biz.owner).map((w) => roundToDollar(w.box3SsWages)));
    const SE8a = l.set('schSE.8a', ownerSsWages, 'Total social security wages and tips from Form(s) W-2');
    const SE8d = l.set('schSE.8d', SE8a, 'Total social security wages');
    const SE9 = l.set('schSE.9', Math.max(0, p.socialSecurity.wageBase - SE8d), 'Remaining social security wage base');
    const SE10 = l.set(
      'schSE.10',
      SE9 > 0 ? rateToDollar(Math.min(SE6, SE9), p.selfEmployment.ssRate) : 0,
      'Social security portion (12.4%)',
    );
    const SE11 = l.set('schSE.11', rateToDollar(SE6, p.selfEmployment.medicareRate), 'Medicare portion (2.9%)');
    seTax = l.set('schSE.12', SE10 + SE11, 'Self-employment tax', 'Line 10 + line 11');
    deductibleSeTax = l.set(
      'schSE.13',
      rateToDollar(seTax, p.selfEmployment.deductibleHalfRate),
      'Deduction for one-half of self-employment tax',
    );
  }

  // 6. Self-Employed SEP, SIMPLE, and qualified plans (Schedule 1 line 16)
  // Maximum deductible SEP for self-employed owner is 20% (= 25% / 1.25) of (Schedule C line 31 - Schedule SE line 13), capped at $70,000 for 2025.
  const netEarnedForSep = Math.max(0, L31 - deductibleSeTax);
  const maxSep = Math.min(p.selfEmployment.sepMaxContribution, rateToDollar(netEarnedForSep, p.selfEmployment.sepEffectiveRate));
  let sepDeduction = 0;
  if (biz.sepContribution === 'max') {
    sepDeduction = maxSep;
  } else if (typeof biz.sepContribution === 'number' && biz.sepContribution > 0) {
    sepDeduction = Math.min(roundToDollar(biz.sepContribution), maxSep);
  }

  // 7. Form 7206 — Self-Employed Health Insurance Deduction (Schedule 1 line 17)
  const ownerPerson = biz.owner === 'spouse' && f.spouse ? f.spouse : f.taxpayer;
  const healthPrem = roundToDollar(biz.healthInsurancePremiums ?? 0);
  const ltcRaw = roundToDollar(biz.longTermCarePremiums ?? 0);
  const ltcAllowed = ltcRaw > 0 ? Math.min(ltcRaw, ltcLimitForAge(ageAtEndOf2025(ownerPerson.dateOfBirth), p)) : 0;
  const totalHealthPrem = healthPrem + ltcAllowed;
  let needsForm7206 = false;
  let seHealthInsuranceDeduction = 0;

  if (totalHealthPrem > 0 && L31 > 0) {
    needsForm7206 = true;
    const F1 = l.set('f7206.1', healthPrem, 'Total paid in 2025 for health insurance coverage established under your business');
    const F2 = l.set('f7206.2', ltcAllowed, 'Qualified long-term care insurance premiums');
    const F3 = l.set('f7206.3', F1 + F2, 'Total health and long-term care premiums');
    const F4 = l.set('f7206.4', Math.max(0, L31), 'Net profit from the business under which the insurance plan is established');
    l.set('f7206.5', Math.max(0, L31), 'Total of all net profits');
    printed.f7206Ratio6 = '1.000';
    const F7 = l.set('f7206.7', deductibleSeTax, 'Deductible part of self-employment tax allocable to this business');
    const F8 = l.set('f7206.8', Math.max(0, F4 - F7), 'Line 4 minus line 7');
    const F9 = l.set('f7206.9', sepDeduction, 'Self-employed SEP, SIMPLE, and qualified plans attributable to this business');
    const F10 = l.set('f7206.10', Math.max(0, F8 - F9), 'Line 8 minus line 9');
    const F13 = l.set('f7206.13', F10, 'Net earned income limit for health insurance deduction');
    seHealthInsuranceDeduction = l.set('f7206.14', Math.min(F3, F13), 'Self-employed health insurance deduction');
  }

  // 8. Schedule 1 — Additional Income (Part I) and Adjustments to Income (Part II)
  const S1_3 = l.set('sch1.3', L31, 'Business income or (loss) (Schedule C)');
  const S1_4 = l.set('sch1.4', form4797.schedule1Line4, 'Other gains or (losses) (Form 4797)');
  const S1_9 = l.set('sch1.9', 0, 'Total other income');
  const S1_10 = l.set('sch1.10', S1_3 + S1_4 + S1_9, 'Additional income', 'Lines 1 through 7 and 9');

  const S1_15 = l.set('sch1.15', deductibleSeTax, 'Deductible part of self-employment tax');
  const S1_16 = l.set('sch1.16', sepDeduction, 'Self-employed SEP, SIMPLE, and qualified plans');
  const S1_17 = l.set('sch1.17', seHealthInsuranceDeduction, 'Self-employed health insurance deduction (Form 7206)');
  const S1_25 = l.set('sch1.25', 0, 'Total other adjustments');
  const S1_26 = l.set('sch1.26', S1_15 + S1_16 + S1_17 + S1_25, 'Total adjustments to income');

  const needsScheduleC = true;
  const needsSchedule1 = needsScheduleC || form4797.needs4797 || S1_10 !== 0 || S1_26 !== 0;

  // 9. Net QBI from this Schedule C business (Reg. §1.199A-3(b)(1)(vi)): net profit or loss, minus the deductible part of
  // SE tax, the SEP deduction and the SE health insurance deduction attributable to it. When K-1s also carry SE earnings,
  // the deductible SE tax is shared in proportion to each source's positive SE income.
  const schCSe = Math.max(0, L31);
  const k1SePositive = Math.max(0, k1SeTotal);
  const seTaxForSchC = schCSe + k1SePositive > 0 ? mulDivToDollar(deductibleSeTax, schCSe, schCSe + k1SePositive) : 0;
  const netQbi = L31 - seTaxForSchC - sepDeduction - seHealthInsuranceDeduction;

  return {
    activeBusiness: biz,
    needsScheduleC,
    needsScheduleSE,
    needsForm8829,
    needsForm7206,
    needsForm4797: form4797.needs4797,
    needsSchedule1,
    netProfitOrLoss: L31,
    seNetEarnings,
    seTax,
    deductibleSeTax,
    sepDeduction,
    seHealthInsuranceDeduction,
    schedule1AdditionalIncome: S1_10,
    schedule1Adjustments: S1_26,
    homeOfficeScheduleAReduction,
    netQbi,
    seTaxForK1s: deductibleSeTax - seTaxForSchC,
    printed,
    form4797,
  };
}

/** Owner's net Schedule C income for Maryland Worksheet 13D two-income subtraction. */
export function ownerScheduleCIncome(f: TaxFacts, who: Owner, l: Ledger): Cents {
  const active = (f.scheduleC ?? []).find((b) => !b.closedInPriorYear);
  if (!active && (f.f1099Nec ?? []).length === 0) return 0;
  const owner = active?.owner ?? f.f1099Nec![0].owner;
  if (owner !== who) return 0;
  return l.get('sch1.3') + l.get('sch1.4') - l.get('sch1.15') - l.get('sch1.16') - l.get('sch1.17');
}
