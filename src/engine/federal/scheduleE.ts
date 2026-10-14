import type { TaxFacts, Owner, RentalProperty, ScheduleK1 } from '../../shared/facts';
import { Ledger } from '../ledger';
import { type Cents, rateToDollar, roundToDollar, sumCents, usd } from '../money';

/** IRS Publication 946 Table A-6: 27.5-year Residential Rental Property Straight-Line Mid-Month Year 1 rates (in ppm), indexed by month 1..12. */
const RESIDENTIAL_275_Y1_PPM: readonly number[] = [
  34_850, // Jan (3.485%)
  31_820, // Feb (3.182%)
  28_790, // Mar (2.879%)
  25_760, // Apr (2.576%)
  22_730, // May (2.273%)
  19_700, // Jun (1.970%)
  16_670, // Jul (1.667%)
  13_640, // Aug (1.364%)
  10_610, // Sep (1.061%)
  7_580, // Oct (0.758%)
  4_550, // Nov (0.455%)
  1_520, // Dec (0.152%)
];

/** IRS Publication 946 Table A-7a: 39-year Nonresidential Real Property Straight-Line Mid-Month Year 1 rates (in ppm), indexed by month 1..12. */
const NONRESIDENTIAL_39_Y1_PPM: readonly number[] = [
  24_610, // Jan (2.461%)
  22_470, // Feb (2.247%)
  20_330, // Mar (2.033%)
  18_190, // Apr (1.819%)
  16_050, // May (1.605%)
  13_910, // Jun (1.391%)
  11_770, // Jul (1.177%)
  9_630, // Aug (0.963%)
  7_490, // Sep (0.749%)
  5_350, // Oct (0.535%)
  3_210, // Nov (0.321%)
  1_070, // Dec (0.107%)
];

function parsePlacedInService(s: string): { month: number; year: number } {
  const m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return { month: Math.max(1, Math.min(12, Number(m[1]))), year: Number(m[2]) };
  const y = s.match(/(\d{4})/);
  return { month: 6, year: y ? Number(y[1]) : 2024 };
}

/** Compute 2025 MACRS depreciation for a single rental asset. */
export function computeAssetDepreciation(asset: NonNullable<RentalProperty['depreciableAssets']>[number]): {
  deduction: Cents;
  in2025: boolean;
  recoveryYears: number;
  monthYear: string;
  basis: Cents;
} {
  const basis = roundToDollar(asset.basis);
  const { month, year } = parsePlacedInService(asset.placedInService);
  const in2025 = asset.placedInServiceIn2025 ?? year === 2025;
  const recoveryYears = asset.recoveryPeriodYears ?? 27.5;
  const monthYear = `${String(month).padStart(2, '0')}/${year}`;

  if (asset.currentYearDepreciation !== undefined) {
    return { deduction: roundToDollar(asset.currentYearDepreciation), in2025, recoveryYears, monthYear, basis };
  }

  let deduction = 0;
  if (recoveryYears === 27.5) {
    const rate = in2025 ? RESIDENTIAL_275_Y1_PPM[month - 1]! : 36_360; // 3.636% full year
    deduction = rateToDollar(basis, rate);
  } else if (recoveryYears === 39) {
    const rate = in2025 ? NONRESIDENTIAL_39_Y1_PPM[month - 1]! : 25_640; // 2.564% full year
    deduction = rateToDollar(basis, rate);
  } else {
    // Straight-line half-year convention for 5/7/15 year improvements
    const fullRate = Math.round(1_000_000 / recoveryYears);
    const rate = in2025 ? Math.round(fullRate / 2) : fullRate;
    deduction = rateToDollar(basis, rate);
  }
  return { deduction, in2025, recoveryYears, monthYear, basis };
}

export interface ScheduleEOutput {
  needsScheduleE: boolean;
  needsScheduleEPage2: boolean;
  needsForm4562: boolean;
  needsForm8582: boolean;
  needsForm7203: boolean;
  /** Net Schedule E income or (loss) -> Schedule 1 line 5 (`sch1.5`). */
  netScheduleEIncome: Cents;
  /** Passive loss carryover to 2026 (positive magnitude). */
  passiveLossCarryoverTo2026: Cents;
  /** Per-activity unallowed passive loss carryovers to 2026. */
  passiveLossCarryoverByActivity: { name: string; unallowedLoss: Cents }[];
  /** S-corp excess distribution capital gain from Form 7203 line 6 note -> Schedule D line 12. */
  sCorpExcessDistributionGain: Cents;
  /** K-1 net Section 1231 gain (loss) after basis/passive limits -> Form 4797 Part I line 2. */
  k1NetSection1231Gain: Cents;
  /** K-1 self-employment net earnings -> Schedule SE line 2. */
  k1SelfEmploymentEarnings: { taxpayer: Cents; spouse: Cents };
  /** QBI trade/business entries from qualifying rentals and K-1s for Form 8995 / 8995-A. */
  qbiEntries: {
    name: string;
    tin: string;
    isSstb: boolean;
    qbi: Cents;
    w2Wages: Cents;
    ubia: Cents;
  }[];
  /** Non-money text/checkbox values for PDF filling (`f1040se.pdf`, `f8582.pdf`, `f4562.pdf`, `f7203.pdf`). */
  printed: Record<string, string | boolean>;
}

/** Compute S-corporation shareholder stock and debt basis limitations (Form 7203) for the first 1120-S K-1 with basis tracking or losses/distributions. */
function computeForm7203ForK1(
  k1: ScheduleK1,
  l: Ledger,
  printed: Record<string, string | boolean>,
): {
  allowedOrdinaryLoss: Cents;
  allowedRentalLoss: Cents;
  excessDistributionCapitalGain: Cents;
  basisComputationRequired: boolean;
} {
  const ord = roundToDollar(k1.ordinaryBusinessIncome);
  const rent = roundToDollar(k1.netRentalRealEstateIncome);
  const basis = k1.sCorpBasis;
  const dist = roundToDollar(basis?.distributions ?? 0);
  const nonded = roundToDollar(basis?.nondeductibleExpenses ?? 0);
  const hasLoss = ord < 0 || rent < 0 || (basis?.priorDisallowedOrdinaryLoss ?? 0) > 0;
  const basisComputationRequired = Boolean(basis) || hasLoss || dist > 0;

  if (!basis) {
    return {
      allowedOrdinaryLoss: ord < 0 ? Math.abs(ord) : 0,
      allowedRentalLoss: rent < 0 ? Math.abs(rent) : 0,
      excessDistributionCapitalGain: 0,
      basisComputationRequired,
    };
  }

  printed['f7203.entityName'] = k1.entityName;
  printed['f7203.entityEin'] = k1.entityEin;

  const L1 = l.set('f7203.1', roundToDollar(basis.beginningStockBasis), 'Stock basis at beginning of year');
  const L2 = l.set('f7203.2', roundToDollar(basis.capitalContributions ?? 0), 'Capital contributions');
  const L3a = l.set('f7203.3a', Math.max(0, ord), 'Ordinary business income');
  const L3b = l.set('f7203.3b', Math.max(0, rent), 'Net rental real estate income');
  const L3c = l.set('f7203.3c', Math.max(0, roundToDollar(k1.otherNetRentalIncome ?? 0)), 'Other net rental income');
  const L3d = l.set('f7203.3d', Math.max(0, roundToDollar(k1.interestIncome)), 'Interest income');
  const L3e = l.set('f7203.3e', Math.max(0, roundToDollar(k1.ordinaryDividends)), 'Ordinary dividends');
  const L3f = l.set('f7203.3f', Math.max(0, roundToDollar(k1.royalties ?? 0)), 'Royalties');
  const netCapGain = Math.max(0, roundToDollar(k1.netShortTermCapitalGain) + roundToDollar(k1.netLongTermCapitalGain));
  const L3g = l.set('f7203.3g', netCapGain, 'Net capital gains');
  const L3h = l.set('f7203.3h', Math.max(0, roundToDollar(k1.netSection1231Gain)), 'Net section 1231 gain');
  const L4 = l.set('f7203.4', sumCents([L3a, L3b, L3c, L3d, L3e, L3f, L3g, L3h]), 'Total income items increasing stock basis');
  const L5 = l.set('f7203.5', L1 + L2 + L4, 'Stock basis before distributions');
  const L6 = l.set('f7203.6', dist, 'Distributions');
  const excessDistributionCapitalGain = Math.max(0, L6 - L5);
  const L7 = l.set('f7203.7', Math.max(0, L5 - L6), 'Stock basis after distributions');

  const L8a = l.set('f7203.8a', nonded, 'Nondeductible expenses');
  const L9 = l.set('f7203.9', L8a, 'Total nondeductible expenses');
  const L10 = l.set('f7203.10', Math.max(0, L7 - L9), 'Stock basis before loss and deduction items');

  // Part II: Shareholder Debt Basis
  const L16 = l.set('f7203.16', roundToDollar(basis.beginningLoanBalance ?? 0), 'Loan balance at beginning of year');
  const L17 = l.set('f7203.17', roundToDollar(basis.additionalLoans ?? 0), 'Additional loans');
  const L18 = l.set('f7203.18', L16 + L17, 'Loan balance before repayment');
  const L19 = l.set('f7203.19', roundToDollar(basis.debtRepayment ?? 0), 'Principal portion of debt repayment');
  l.set('f7203.20', Math.max(0, L18 - L19), 'Loan balance at end of year');

  const L21 = l.set(
    'f7203.21',
    roundToDollar(basis.beginningDebtBasis ?? basis.beginningLoanBalance ?? 0),
    'Debt basis at beginning of year',
  );
  const L22 = l.set('f7203.22', L17, 'Additional loans');
  const L24 = l.set('f7203.24', L21 + L22, 'Debt basis before repayment');
  const L26 = l.set('f7203.26', L18 > 0 ? roundToDollar(Math.round((L24 * L19) / L18)) : 0, 'Nontaxable debt repayment');
  const L27 = l.set('f7203.27', Math.max(0, L24 - L26), 'Debt basis before nondeductible expenses and losses');
  const excessNonded = Math.max(0, L9 - L7);
  const L28 = l.set('f7203.28', excessNonded, 'Nondeductible expenses in excess of stock basis');
  const L29 = l.set('f7203.29', Math.max(0, L27 - L28), 'Debt basis before losses and deductions');

  // Part III: Allowable Loss and Deduction Items (lines 35 & 36)
  const ordLossCur = ord < 0 ? Math.abs(ord) : 0;
  const ordLossPrior = roundToDollar(basis.priorDisallowedOrdinaryLoss ?? 0);
  const rentLossCur = rent < 0 ? Math.abs(rent) : 0;
  const totalLoss = ordLossCur + ordLossPrior + rentLossCur;

  l.set('f7203.35a', ordLossCur, 'Current year ordinary business loss');
  l.set('f7203.35b', ordLossPrior, 'Carryover ordinary business loss');
  l.set('f7203.36a', rentLossCur, 'Current year net rental real estate loss');

  const allowStockTotal = Math.min(L10, totalLoss);
  const remLossAfterStock = totalLoss - allowStockTotal;
  const allowDebtTotal = Math.min(L29, remLossAfterStock);
  const carryoverTotal = remLossAfterStock - allowDebtTotal;

  // Allocate stock & debt basis proportionally between ordinary loss (line 35) and rental loss (line 36)
  const ordTotal = ordLossCur + ordLossPrior;
  const ordStock = totalLoss > 0 ? roundToDollar(Math.round((allowStockTotal * ordTotal) / totalLoss)) : 0;
  const rentStock = allowStockTotal - ordStock;
  const ordDebt = totalLoss > 0 ? roundToDollar(Math.round((allowDebtTotal * ordTotal) / totalLoss)) : 0;
  const rentDebt = allowDebtTotal - ordDebt;
  const ordCarry = ordTotal - ordStock - ordDebt;
  const rentCarry = rentLossCur - rentStock - rentDebt;

  l.set('f7203.35c', ordStock, 'Allowable ordinary loss from stock basis');
  l.set('f7203.35d', ordDebt, 'Allowable ordinary loss from debt basis');
  l.set('f7203.35e', ordCarry, 'Carryover ordinary loss');
  l.set('f7203.36c', rentStock, 'Allowable rental loss from stock basis');
  l.set('f7203.36d', rentDebt, 'Allowable rental loss from debt basis');
  l.set('f7203.36e', rentCarry, 'Carryover rental loss');

  l.set('f7203.47a', ordLossCur + rentLossCur, 'Total current year losses');
  l.set('f7203.47b', ordLossPrior, 'Total carryover losses from prior year');
  l.set('f7203.47c', allowStockTotal, 'Total allowable loss from stock basis');
  l.set('f7203.47d', allowDebtTotal, 'Total allowable loss from debt basis');
  l.set('f7203.47e', carryoverTotal, 'Total carryover loss to 2026');

  const L11 = l.set('f7203.11', allowStockTotal, 'Allowable loss and deduction items from stock basis');
  const L14 = l.set('f7203.14', L11, 'Total reductions to stock basis');
  l.set('f7203.15', Math.max(0, L10 - L14), 'Stock basis at end of year');

  const L30 = l.set('f7203.30', allowDebtTotal, 'Allowable losses in excess of stock basis');
  l.set('f7203.31', Math.max(0, L29 - L30), 'Debt basis at end of year');

  return {
    allowedOrdinaryLoss: ordStock + ordDebt,
    allowedRentalLoss: rentStock + rentDebt,
    excessDistributionCapitalGain,
    basisComputationRequired: true,
  };
}

/**
 * Compute Schedule E (Part I Rentals/Royalties, Part II Partnerships/S-Corps, Part III Estates/Trusts, Part V Summary),
 * Form 4562 (Depreciation), Form 8582 (Passive Activity Loss Limitations), and Form 7203 (S-Corp Basis).
 *
 * `magiBeforePassive`: Modified AGI before passive activity income/loss, deductible SE tax, and taxable Social Security
 * (used on Form 8582 line 6 for the $100,000–$150,000 rental real estate special allowance phase-out).
 */
export function computeScheduleE(f: TaxFacts, l: Ledger, magiBeforePassive: Cents): ScheduleEOutput {
  const printed: Record<string, string | boolean> = {};
  const rentals = f.rentals ?? [];
  const k1s = f.k1s ?? [];
  const qbiEntries: ScheduleEOutput['qbiEntries'] = [];

  if (rentals.length === 0 && k1s.length === 0) {
    return {
      needsScheduleE: false,
      needsScheduleEPage2: false,
      needsForm4562: false,
      needsForm8582: false,
      needsForm7203: false,
      netScheduleEIncome: 0,
      passiveLossCarryoverTo2026: 0,
      passiveLossCarryoverByActivity: [],
      sCorpExcessDistributionGain: 0,
      k1NetSection1231Gain: 0,
      k1SelfEmploymentEarnings: { taxpayer: 0, spouse: 0 },
      qbiEntries: [],
      printed,
    };
  }

  // --- Step 1: Form 4562 & Rental Property tentative income/loss (Schedule E Part I lines 1–21) ---
  let needsForm4562 = false;
  let f4562PriorMacrs17 = 0;
  let f4562Res2025Basis = 0;
  let f4562Res2025Ded = 0;
  let f4562Res2025MonthYear = '';
  let f4562Nonres2025Basis = 0;
  let f4562Nonres2025Ded = 0;
  let f4562Nonres2025MonthYear = '';

  const cols = ['A', 'B', 'C'] as const;
  let totalRents23a = 0;
  let totalRoyalties23b = 0;
  let totalMortgage23c = 0;
  let totalDepr23d = 0;
  let totalExpenses23e = 0;

  interface PassiveActivityItem {
    kind: 'rental' | 'k1_28' | 'k1_33';
    colOrRowIndex: number;
    name: string;
    activeRental: boolean;
    netIncome: Cents;
    netLoss: Cents; // positive magnitude
    priorUnallowed: Cents; // positive magnitude
    allowedLoss: Cents; // positive magnitude
    unallowedLoss: Cents; // positive magnitude
    owner: Owner;
    qualifiesForQbi?: boolean;
  }

  const passiveActivities: PassiveActivityItem[] = [];
  const rentalTentativeNet: Cents[] = [];

  rentals.slice(0, 3).forEach((r, idx) => {
    const col = cols[idx]!;
    printed[`schE.1a.${col}`] = r.address;
    printed[`schE.1b.${col}`] = String(r.propertyType);
    if (r.propertyType === 8 && r.otherPropertyTypeDescription) {
      printed['schE.1b.other'] = r.otherPropertyTypeDescription;
    }
    printed[`schE.2.fair.${col}`] = String(r.fairRentalDays);
    printed[`schE.2.personal.${col}`] = String(r.personalUseDays);
    if (r.qjv) printed[`schE.2.qjv.${col}`] = true;

    const rents = l.set(`schE.3.${col}`, roundToDollar(r.rentsReceived), `Rents received (${col})`);
    const royalties = l.set(`schE.4.${col}`, roundToDollar(r.royaltiesReceived ?? 0), `Royalties received (${col})`);
    totalRents23a += rents;
    totalRoyalties23b += royalties;

    const e = r.expenses;
    const L5 = l.set(`schE.5.${col}`, roundToDollar(e.advertising ?? 0), `Advertising (${col})`);
    const L6 = l.set(`schE.6.${col}`, roundToDollar(e.autoAndTravel ?? 0), `Auto and travel (${col})`);
    const L7 = l.set(`schE.7.${col}`, roundToDollar(e.cleaningAndMaintenance ?? 0), `Cleaning and maintenance (${col})`);
    const L8 = l.set(`schE.8.${col}`, roundToDollar(e.commissions ?? 0), `Commissions (${col})`);
    const L9 = l.set(`schE.9.${col}`, roundToDollar(e.insurance ?? 0), `Insurance (${col})`);
    const L10 = l.set(`schE.10.${col}`, roundToDollar(e.legalAndProfessional ?? 0), `Legal and professional fees (${col})`);
    const L11 = l.set(`schE.11.${col}`, roundToDollar(e.managementFees ?? 0), `Management fees (${col})`);
    const L12 = l.set(`schE.12.${col}`, roundToDollar(e.mortgageInterest ?? 0), `Mortgage interest (${col})`);
    const L13 = l.set(`schE.13.${col}`, roundToDollar(e.otherInterest ?? 0), `Other interest (${col})`);
    const L14 = l.set(`schE.14.${col}`, roundToDollar(e.repairs ?? 0), `Repairs (${col})`);
    const L15 = l.set(`schE.15.${col}`, roundToDollar(e.supplies ?? 0), `Supplies (${col})`);
    const L16 = l.set(`schE.16.${col}`, roundToDollar(e.taxes ?? 0), `Taxes (${col})`);
    const L17 = l.set(`schE.17.${col}`, roundToDollar(e.utilities ?? 0), `Utilities (${col})`);

    let assetDepr = 0;
    for (const a of r.depreciableAssets ?? []) {
      const comp = computeAssetDepreciation(a);
      assetDepr += comp.deduction;
      if (comp.in2025) {
        needsForm4562 = true;
        if (!printed['f4562.activity']) printed['f4562.activity'] = `Schedule E (${r.address.split(',')[0]})`;
        if (comp.recoveryYears === 39) {
          f4562Nonres2025Basis += comp.basis;
          f4562Nonres2025Ded += comp.deduction;
          f4562Nonres2025MonthYear = comp.monthYear;
        } else {
          f4562Res2025Basis += comp.basis;
          f4562Res2025Ded += comp.deduction;
          f4562Res2025MonthYear = comp.monthYear;
        }
      } else {
        f4562PriorMacrs17 += comp.deduction;
      }
    }
    const L18 = l.set(`schE.18.${col}`, roundToDollar(e.depreciation ?? 0) + assetDepr, `Depreciation expense (${col})`);
    const L19 = l.set(`schE.19.${col}`, roundToDollar(e.other ?? 0), `Other expenses (${col})`);
    if (e.otherDescription) printed['schE.19.desc'] = e.otherDescription;

    const L20 = l.set(
      `schE.20.${col}`,
      sumCents([L5, L6, L7, L8, L9, L10, L11, L12, L13, L14, L15, L16, L17, L18, L19]),
      `Total expenses (${col})`,
    );
    const L21 = l.set(`schE.21.${col}`, rents + royalties - L20, `Tentative rental/royalty net income or loss (${col})`);
    rentalTentativeNet.push(L21);

    totalMortgage23c += L12;
    totalDepr23d += L18;
    totalExpenses23e += L20;

    // Royalties (type 6) are portfolio/nonpassive; rental real estate is passive
    if (r.propertyType !== 6) {
      passiveActivities.push({
        kind: 'rental',
        colOrRowIndex: idx,
        name: r.address.split(',')[0] || `Property ${col}`,
        activeRental: r.activeParticipation !== false,
        netIncome: Math.max(0, L21),
        netLoss: L21 < 0 ? Math.abs(L21) : 0,
        priorUnallowed: roundToDollar(r.priorUnallowedPassiveLoss ?? 0),
        allowedLoss: 0,
        unallowedLoss: 0,
        owner: r.owner,
        qualifiesForQbi: r.qualifiesForQbi,
      });
    }
  });

  if (rentals.length > 0) {
    printed['schE.A.no'] = true;
    l.set('schE.23a', totalRents23a, 'Total rents received');
    l.set('schE.23b', totalRoyalties23b, 'Total royalties received');
    l.set('schE.23c', totalMortgage23c, 'Total mortgage interest');
    l.set('schE.23d', totalDepr23d, 'Total depreciation');
    l.set('schE.23e', totalExpenses23e, 'Total expenses');
  }

  // Record Form 4562 ledger lines when needed
  if (needsForm4562) {
    l.set('f4562.17', f4562PriorMacrs17, 'MACRS deductions for assets placed in service before 2025');
    if (f4562Res2025Ded > 0) {
      printed['f4562.19i.b'] = f4562Res2025MonthYear;
      l.set('f4562.19i.c', f4562Res2025Basis, 'Residential rental property basis');
      l.set('f4562.19i.g', f4562Res2025Ded, 'Residential rental property depreciation deduction');
    }
    if (f4562Nonres2025Ded > 0) {
      printed['f4562.19j.b'] = f4562Nonres2025MonthYear;
      l.set('f4562.19j.c', f4562Nonres2025Basis, 'Nonresidential real property basis');
      l.set('f4562.19j.g', f4562Nonres2025Ded, 'Nonresidential real property depreciation deduction');
    }
    l.set('f4562.22', f4562PriorMacrs17 + f4562Res2025Ded + f4562Nonres2025Ded, 'Form 4562 line 22 total depreciation');
  }

  // --- Step 2: K-1s (1065, 1120-S, 1041) & Form 7203 ---
  let needsForm7203 = false;
  let sCorpExcessDistributionGain = 0;
  let k1NetSection1231Gain = 0;
  const k1SelfEmploymentEarnings = { taxpayer: 0, spouse: 0 };

  const p2Rows = k1s.filter((k) => k.entityType === '1065' || k.entityType === '1120S').slice(0, 4);
  const p3Rows = k1s.filter((k) => k.entityType === '1041').slice(0, 2);

  interface PartIIRowState {
    k1: ScheduleK1;
    rowLetter: 'A' | 'B' | 'C' | 'D';
    passiveIncome: Cents;
    passiveLossBefore8582: Cents;
    nonpassiveLoss: Cents;
    sec179: Cents;
    nonpassiveIncome: Cents;
    basisRequired: boolean;
  }

  const p2States: PartIIRowState[] = [];
  const rowLetters = ['A', 'B', 'C', 'D'] as const;

  p2Rows.forEach((k1, idx) => {
    const rowLetter = rowLetters[idx]!;
    let ord = roundToDollar(k1.ordinaryBusinessIncome);
    let rent = roundToDollar(k1.netRentalRealEstateIncome) + roundToDollar(k1.otherNetRentalIncome ?? 0);
    const guar = roundToDollar(k1.guaranteedPayments ?? 0);
    const sec179 = roundToDollar(k1.section179Deduction ?? 0);
    let basisRequired = false;

    if (k1.entityType === '1120S') {
      const bOut = computeForm7203ForK1(k1, l, printed);
      basisRequired = bOut.basisComputationRequired;
      if (k1.sCorpBasis) {
        needsForm7203 = true;
        if (ord < 0) ord = -bOut.allowedOrdinaryLoss;
        if (rent < 0) rent = -bOut.allowedRentalLoss;
        sCorpExcessDistributionGain += bOut.excessDistributionCapitalGain;
      }
    }

    k1NetSection1231Gain += roundToDollar(k1.netSection1231Gain);
    if (k1.selfEmploymentEarnings) {
      k1SelfEmploymentEarnings[k1.owner] += roundToDollar(k1.selfEmploymentEarnings);
    }

    let passiveIncome = 0;
    let passiveLossBefore8582 = 0;
    let nonpassiveIncome = guar;
    let nonpassiveLoss = 0;

    if (k1.isMaterialParticipation) {
      if (ord >= 0) nonpassiveIncome += ord;
      else nonpassiveLoss += Math.abs(ord);
    } else {
      if (ord >= 0) passiveIncome += ord;
      else passiveLossBefore8582 += Math.abs(ord);
    }

    // Rental real estate on K-1 box 2/3 is always passive (unless real estate professional)
    if (rent >= 0) passiveIncome += rent;
    else passiveLossBefore8582 += Math.abs(rent);

    // Net passive for this K-1 row
    const netPassive = passiveIncome - passiveLossBefore8582;
    const rowPassiveIncome = Math.max(0, netPassive);
    const rowPassiveLoss = netPassive < 0 ? Math.abs(netPassive) : 0;

    if (rowPassiveIncome > 0 || rowPassiveLoss > 0 || (k1.priorUnallowedPassiveLoss ?? 0) > 0) {
      passiveActivities.push({
        kind: 'k1_28',
        colOrRowIndex: idx,
        name: k1.entityName,
        activeRental: Boolean(k1.activeRentalParticipation && rent < 0 && ord === 0),
        netIncome: rowPassiveIncome,
        netLoss: rowPassiveLoss,
        priorUnallowed: roundToDollar(k1.priorUnallowedPassiveLoss ?? 0),
        allowedLoss: 0,
        unallowedLoss: 0,
        owner: k1.owner,
      });
    }

    if (k1.qbiAmount !== undefined && k1.qbiAmount !== 0) {
      qbiEntries.push({
        name: k1.entityName,
        tin: k1.entityEin.replace(/\D/g, ''),
        isSstb: Boolean(k1.isSstb),
        qbi: roundToDollar(k1.qbiAmount),
        w2Wages: roundToDollar(k1.qbiW2Wages ?? 0),
        ubia: roundToDollar(k1.qbiUbia ?? 0),
      });
    }

    p2States.push({
      k1,
      rowLetter,
      passiveIncome: rowPassiveIncome,
      passiveLossBefore8582: rowPassiveLoss,
      nonpassiveLoss,
      sec179,
      nonpassiveIncome,
      basisRequired,
    });
  });

  // --- Step 3: Form 8582 Passive Activity Loss Limitations ---
  const activeRentalActs = passiveActivities.filter((a) => a.activeRental);
  const otherPassiveActs = passiveActivities.filter((a) => !a.activeRental);

  const L1a = sumCents(activeRentalActs.map((a) => a.netIncome));
  const L1b = sumCents(activeRentalActs.map((a) => a.netLoss));
  const L1c = sumCents(activeRentalActs.map((a) => a.priorUnallowed));
  const L1d = L1a - L1b - L1c;

  const L2a = sumCents(otherPassiveActs.map((a) => a.netIncome));
  const L2b = sumCents(otherPassiveActs.map((a) => a.netLoss));
  const L2c = sumCents(otherPassiveActs.map((a) => a.priorUnallowed));
  const L2d = L2a - L2b - L2c;

  const L3 = L1d + L2d;
  const totalGrossPassiveLosses = L1b + L1c + L2b + L2c;
  const needsForm8582 = totalGrossPassiveLosses > 0 && L3 < 0;

  let passiveLossCarryoverTo2026 = 0;

  if (totalGrossPassiveLosses > 0) {
    if (L3 >= 0) {
      // All passive losses (including prior year unallowed) are allowed in full!
      for (const a of passiveActivities) {
        a.allowedLoss = a.netLoss + a.priorUnallowed;
        a.unallowedLoss = 0;
      }
    } else {
      // Form 8582 required: L3 is a net passive loss
      l.set('f8582.1a', L1a, 'Rental real estate activities with net income');
      l.set('f8582.1b', L1b, 'Rental real estate activities with net loss');
      l.set('f8582.1c', L1c, 'Prior years unallowed rental real estate losses');
      l.set('f8582.1d', L1d, 'Net rental real estate passive income or loss');
      l.set('f8582.2a', L2a, 'All other passive activities with net income');
      l.set('f8582.2b', L2b, 'All other passive activities with net loss');
      l.set('f8582.2c', L2c, 'Prior years unallowed other passive losses');
      l.set('f8582.2d', L2d, 'Net other passive income or loss');
      l.set('f8582.3', L3, 'Total net passive income or loss');

      // Part II: Special $25,000 allowance for active-participation rental real estate
      let L9 = 0;
      if (L1d < 0 && f.filingStatus !== 'mfs') {
        const L4 = l.set('f8582.4', Math.min(Math.abs(L1d), Math.abs(L3)), 'Smaller of line 1d loss or line 3 loss');
        const L5 = l.set('f8582.5', usd(150_000), 'Phase-out ceiling ($150,000)');
        const L6 = l.set('f8582.6', Math.max(0, magiBeforePassive), 'Modified adjusted gross income');
        if (L6 < L5) {
          const L7 = l.set('f8582.7', L5 - L6, 'Line 5 minus line 6');
          const L8 = l.set('f8582.8', Math.min(usd(25_000), rateToDollar(L7, 500_000)), '50% of line 7, max $25,000');
          L9 = l.set('f8582.9', Math.min(L4, L8), 'Special allowance for rental real estate');
        } else {
          l.set('f8582.9', 0, 'Special allowance phased out above $150,000 MAGI');
        }
      }

      const L10 = l.set('f8582.10', L1a + L2a, 'Total passive income on lines 1a and 2a');
      const L11 = l.set('f8582.11', L9 + L10, 'Total losses allowed from all passive activities for 2025');

      // Allocate unallowed loss (`totalGrossPassiveLosses - L11`) across loss activities
      const totalUnallowed = Math.max(0, totalGrossPassiveLosses - L11);
      passiveLossCarryoverTo2026 = totalUnallowed;

      const lossActs = passiveActivities.filter((a) => a.netLoss + a.priorUnallowed > a.netIncome);
      const sumNetLosses = sumCents(lossActs.map((a) => a.netLoss + a.priorUnallowed - a.netIncome));
      let remUnallowed = totalUnallowed;
      lossActs.forEach((a, i) => {
        const actLoss = a.netLoss + a.priorUnallowed - a.netIncome;
        const unallowed =
          i === lossActs.length - 1
            ? remUnallowed
            : sumNetLosses > 0
              ? roundToDollar(Math.round((totalUnallowed * actLoss) / sumNetLosses))
              : 0;
        remUnallowed -= unallowed;
        a.unallowedLoss = Math.max(0, unallowed);
        a.allowedLoss = Math.max(0, actLoss - a.unallowedLoss);
      });

      // Populate Form 8582 Part IV, V, VI, VII, VIII printed rows for PDF
      activeRentalActs.slice(0, 5).forEach((a, i) => {
        const r = i + 1;
        printed[`f8582.p4.r${r}.name`] = a.name;
        if (a.netIncome > 0) l.set(`f8582.p4.r${r}.a`, a.netIncome, 'Part IV net income');
        if (a.netLoss > 0) l.set(`f8582.p4.r${r}.b`, a.netLoss, 'Part IV net loss');
        if (a.priorUnallowed > 0) l.set(`f8582.p4.r${r}.c`, a.priorUnallowed, 'Part IV prior unallowed');
        const overall = a.netIncome - a.netLoss - a.priorUnallowed;
        if (overall >= 0) l.set(`f8582.p4.r${r}.d`, overall, 'Part IV overall gain');
        else l.set(`f8582.p4.r${r}.e`, Math.abs(overall), 'Part IV overall loss');
      });
      otherPassiveActs.slice(0, 5).forEach((a, i) => {
        const r = i + 1;
        printed[`f8582.p5.r${r}.name`] = a.name;
        if (a.netIncome > 0) l.set(`f8582.p5.r${r}.a`, a.netIncome, 'Part V net income');
        if (a.netLoss > 0) l.set(`f8582.p5.r${r}.b`, a.netLoss, 'Part V net loss');
        if (a.priorUnallowed > 0) l.set(`f8582.p5.r${r}.c`, a.priorUnallowed, 'Part V prior unallowed');
        const overall = a.netIncome - a.netLoss - a.priorUnallowed;
        if (overall >= 0) l.set(`f8582.p5.r${r}.d`, overall, 'Part V overall gain');
        else l.set(`f8582.p5.r${r}.e`, Math.abs(overall), 'Part V overall loss');
      });
      lossActs.slice(0, 5).forEach((a, i) => {
        const r = i + 1;
        const formRef = a.kind === 'rental' ? 'Sch E, line 22' : 'Sch E, Pt II';
        const actLoss = a.netLoss + a.priorUnallowed - a.netIncome;
        printed[`f8582.p7.r${r}.name`] = a.name;
        printed[`f8582.p7.r${r}.form`] = formRef;
        l.set(`f8582.p7.r${r}.a`, actLoss, 'Part VII loss');
        printed[`f8582.p7.r${r}.b`] = sumNetLosses > 0 ? (actLoss / sumNetLosses).toFixed(2) : '1.00';
        l.set(`f8582.p7.r${r}.c`, a.unallowedLoss, 'Part VII unallowed loss');

        printed[`f8582.p8.r${r}.name`] = a.name;
        printed[`f8582.p8.r${r}.form`] = formRef;
        l.set(`f8582.p8.r${r}.a`, actLoss, 'Part VIII loss');
        l.set(`f8582.p8.r${r}.b`, a.unallowedLoss, 'Part VIII unallowed loss');
        l.set(`f8582.p8.r${r}.c`, a.allowedLoss, 'Part VIII allowed loss');
      });
      l.set('f8582.p8.total.a', sumNetLosses, 'Part VIII total loss');
      l.set('f8582.p8.total.b', totalUnallowed, 'Part VIII total unallowed loss');
      l.set('f8582.p8.total.c', sumCents(lossActs.map((a) => a.allowedLoss)), 'Part VIII total allowed loss');
    }
  }

  // --- Step 4: Finalize Schedule E Part I lines 22, 24, 25, 26 ---
  let rentalPositive24 = 0;
  let rentalAllowedLosses25 = 0;

  rentals.slice(0, 3).forEach((r, idx) => {
    const col = cols[idx]!;
    const L21 = rentalTentativeNet[idx]!;
    if (L21 >= 0) {
      rentalPositive24 += L21;
    } else if (r.propertyType === 6) {
      // Royalty loss goes directly to line 25
      rentalAllowedLosses25 += Math.abs(L21);
    } else {
      const pa = passiveActivities.find((a) => a.kind === 'rental' && a.colOrRowIndex === idx);
      const allowed = pa ? pa.allowedLoss : Math.abs(L21);
      l.set(`schE.22.${col}`, allowed, `Deductible rental real estate loss (${col})`);
      rentalAllowedLosses25 += allowed;
    }

    // If rental qualifies as a §199A trade or business, include its allowed net income/loss in QBI
    if (r.qualifiesForQbi) {
      const pa = passiveActivities.find((a) => a.kind === 'rental' && a.colOrRowIndex === idx);
      const qbiNet = L21 >= 0 ? L21 : -(pa ? pa.allowedLoss : Math.abs(L21));
      if (qbiNet !== 0) {
        qbiEntries.push({
          name: r.address.split(',')[0] || `Rental ${col}`,
          tin: f.taxpayer.ssn,
          isSstb: false,
          qbi: qbiNet,
          w2Wages: 0,
          ubia: sumCents((r.depreciableAssets ?? []).map((a) => roundToDollar(a.basis))),
        });
      }
    }
  });

  if (rentals.length > 0) {
    l.set('schE.24', rentalPositive24, 'Schedule E line 24 positive rental/royalty income');
    l.set('schE.25', rentalAllowedLosses25, 'Schedule E line 25 deductible rental/royalty losses');
    l.set('schE.26', rentalPositive24 - rentalAllowedLosses25, 'Schedule E line 26 net rental real estate and royalty income or loss');
  }
  const L26 = l.get('schE.26');

  // --- Step 5: Finalize Schedule E Page 2 (Part II Partnerships/S-Corps, Part III Estates/Trusts, Part V Summary) ---
  const needsScheduleEPage2 = p2States.length > 0 || p3Rows.length > 0;
  let L32 = 0;
  let L37 = 0;

  if (p2States.length > 0) {
    const hasPriorUnallowed = p2States.some(
      (s) => (s.k1.priorUnallowedPassiveLoss ?? 0) > 0 || (s.k1.sCorpBasis?.priorDisallowedOrdinaryLoss ?? 0) > 0,
    );
    printed[hasPriorUnallowed ? 'schE.27.yes' : 'schE.27.no'] = true;

    let sum29a_h = 0;
    let sum29a_k = 0;
    let sum29b_g = 0;
    let sum29b_i = 0;
    let sum29b_j = 0;

    p2States.forEach((st, idx) => {
      const row = st.rowLetter;
      printed[`schE.28.${row}.a`] = st.k1.entityName;
      printed[`schE.28.${row}.b`] = st.k1.entityType === '1120S' ? 'S' : 'P';
      if (st.k1.isForeignPartnership) printed[`schE.28.${row}.c`] = true;
      printed[`schE.28.${row}.d`] = st.k1.entityEin;
      if (st.basisRequired) printed[`schE.28.${row}.e`] = true;

      const pa = passiveActivities.find((a) => a.kind === 'k1_28' && a.colOrRowIndex === idx);
      const colG = pa ? pa.allowedLoss : st.passiveLossBefore8582;
      const colH = st.passiveIncome;
      const colI = st.nonpassiveLoss;
      const colJ = st.sec179;
      const colK = st.nonpassiveIncome;

      if (colG > 0) l.set(`schE.28.${row}.g`, colG, `Part II row ${row} col (g) passive loss allowed`);
      if (colH > 0) l.set(`schE.28.${row}.h`, colH, `Part II row ${row} col (h) passive income`);
      if (colI > 0) l.set(`schE.28.${row}.i`, colI, `Part II row ${row} col (i) nonpassive loss allowed`);
      if (colJ > 0) l.set(`schE.28.${row}.j`, colJ, `Part II row ${row} col (j) section 179 deduction`);
      if (colK > 0) l.set(`schE.28.${row}.k`, colK, `Part II row ${row} col (k) nonpassive income`);

      sum29a_h += colH;
      sum29a_k += colK;
      sum29b_g += colG;
      sum29b_i += colI;
      sum29b_j += colJ;
    });

    l.set('schE.29a.h', sum29a_h, 'Total Part II passive income');
    l.set('schE.29a.k', sum29a_k, 'Total Part II nonpassive income');
    l.set('schE.29b.g', sum29b_g, 'Total Part II passive loss allowed');
    l.set('schE.29b.i', sum29b_i, 'Total Part II nonpassive loss allowed');
    l.set('schE.29b.j', sum29b_j, 'Total Part II section 179 expense');

    const L30 = l.set('schE.30', sum29a_h + sum29a_k, 'Schedule E line 30 total partnership/S-corp income');
    const L31 = l.set('schE.31', sum29b_g + sum29b_i + sum29b_j, 'Schedule E line 31 total partnership/S-corp loss');
    L32 = l.set('schE.32', L30 - L31, 'Schedule E line 32 net partnership and S corporation income or loss');
  }

  if (p3Rows.length > 0) {
    const tLetters = ['A', 'B'] as const;
    let sum34a_d = 0;
    let sum34a_f = 0;
    const sum34b_c = 0;
    let sum34b_e = 0;

    p3Rows.forEach((k1, idx) => {
      const row = tLetters[idx]!;
      printed[`schE.33.${row}.a`] = k1.entityName;
      printed[`schE.33.${row}.b`] = k1.entityEin;

      const passInc = Math.max(0, roundToDollar(k1.netRentalRealEstateIncome) + roundToDollar(k1.otherNetRentalIncome ?? 0));
      const otherInc = Math.max(0, roundToDollar(k1.ordinaryBusinessIncome) + roundToDollar(k1.trustOtherIncome ?? 0));
      const otherLoss = Math.abs(Math.min(0, roundToDollar(k1.ordinaryBusinessIncome) + roundToDollar(k1.trustOtherIncome ?? 0)));

      if (passInc > 0) l.set(`schE.33.${row}.d`, passInc, `Part III row ${row} col (d) passive income`);
      if (otherLoss > 0) l.set(`schE.33.${row}.e`, otherLoss, `Part III row ${row} col (e) deduction or loss`);
      if (otherInc > 0) l.set(`schE.33.${row}.f`, otherInc, `Part III row ${row} col (f) other income`);

      sum34a_d += passInc;
      sum34a_f += otherInc;
      sum34b_e += otherLoss;
    });

    l.set('schE.34a.d', sum34a_d, 'Total Part III passive income');
    l.set('schE.34a.f', sum34a_f, 'Total Part III other income');
    l.set('schE.34b.c', sum34b_c, 'Total Part III passive loss allowed');
    l.set('schE.34b.e', sum34b_e, 'Total Part III deduction or loss');

    const L35 = l.set('schE.35', sum34a_d + sum34a_f, 'Schedule E line 35 total estate/trust income');
    const L36 = l.set('schE.36', sum34b_c + sum34b_e, 'Schedule E line 36 total estate/trust loss');
    L37 = l.set('schE.37', L35 - L36, 'Schedule E line 37 net estate and trust income or loss');
  }

  const netScheduleEIncome = L26 + L32 + L37;
  if (needsScheduleEPage2) {
    l.set('schE.41', netScheduleEIncome, 'Schedule E line 41 total supplemental income or loss');
  }
  l.set('sch1.5', netScheduleEIncome, 'Schedule 1 line 5: Rental real estate, royalties, partnerships, S corporations, trusts, etc.');

  return {
    needsScheduleE: true,
    needsScheduleEPage2,
    needsForm4562,
    needsForm8582,
    needsForm7203,
    netScheduleEIncome,
    passiveLossCarryoverTo2026,
    passiveLossCarryoverByActivity: passiveActivities
      .filter((a) => a.unallowedLoss > 0)
      .map((a) => ({ name: a.name, unallowedLoss: a.unallowedLoss })),
    sCorpExcessDistributionGain,
    k1NetSection1231Gain,
    k1SelfEmploymentEarnings,
    qbiEntries,
    printed,
  };
}

/** Per-spouse net Schedule E income or (loss) for Maryland two-income Worksheet 13D. */
export function ownerScheduleEIncome(f: TaxFacts, out: ScheduleEOutput): { taxpayer: Cents; spouse: Cents } {
  const res = { taxpayer: 0, spouse: 0 };
  if (!out.needsScheduleE) return res;
  // Attribute Schedule E net income by owner of rentals and K-1s
  const rentals = f.rentals ?? [];
  const k1s = f.k1s ?? [];
  if (rentals.length + k1s.length === 1) {
    const owner = rentals[0]?.owner ?? k1s[0]?.owner ?? 'taxpayer';
    res[owner] = out.netScheduleEIncome;
    return res;
  }
  for (const r of rentals) {
    const exp = sumCents(Object.values(r.expenses).filter((v): v is Cents => typeof v === 'number'));
    const depr = sumCents((r.depreciableAssets ?? []).map((a) => computeAssetDepreciation(a).deduction));
    res[r.owner] += roundToDollar(r.rentsReceived) + roundToDollar(r.royaltiesReceived ?? 0) - exp - depr;
  }
  for (const k of k1s) {
    res[k.owner] +=
      roundToDollar(k.ordinaryBusinessIncome) +
      roundToDollar(k.netRentalRealEstateIncome) +
      roundToDollar(k.otherNetRentalIncome ?? 0) +
      roundToDollar(k.guaranteedPayments ?? 0) +
      roundToDollar(k.trustOtherIncome ?? 0) -
      roundToDollar(k.section179Deduction ?? 0);
  }
  return res;
}
