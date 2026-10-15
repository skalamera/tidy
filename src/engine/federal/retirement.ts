import { rateToDollar, roundToDollar, sumCents, usd, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { Form1099R, Person, TaxFacts } from '../../shared/facts';

/** Born before January 2, 1961 = 65 or older at the end of 2025 (Form 1040 line 12d / Schedule 1-A Part V). */
export const is65OrOlder = (dob: string | null | undefined): boolean => Boolean(dob && dob < '1961-01-02');

/** Valid 9-digit SSN required for the Schedule 1-A Enhanced Deduction for Seniors (ITINs starting with 9 do not qualify). */
const hasValidSsn = (p: Person | null | undefined): boolean => Boolean(p && /^\d{9}$/.test(p.ssn) && !p.ssn.startsWith('9'));

/** Box 2a, except for a traditional, SEP or SIMPLE IRA whose payer left it blank or checked 2b "taxable amount not
 *  determined": then all of the distribution is taxable, because after-tax IRA basis needs Form 8606 (a blocker).
 *  Form 1040 instructions, lines 4a and 4b. Direct rollovers (code G/H) are left as reported. */
export function reportedTaxable(r: Form1099R): Cents {
  const codes = r.box7Codes.toUpperCase();
  const rollover = codes.includes('G') || codes.includes('H');
  if (r.iraSepSimple && !rollover && r.box2aTaxableAmount === 0 && (r.box2aBlank === true || r.box2bTaxableNotDetermined))
    return r.box1GrossDistribution;
  return r.box2aTaxableAmount;
}

/** IRA lines (4a/4b): traditional, SEP and SIMPLE IRAs (the box 7 checkbox) and Roth IRAs (codes J, Q, T, which
 *  leave that box unchecked). */
export const isIraDistribution = (r: Form1099R): boolean => r.iraSepSimple || /[JQT]/.test(r.box7Codes.toUpperCase());

/** Form 1099-R net taxable amount after rollover, QCD, or PSO exclusions. */
export function taxableDistribution(
  r: Form1099R,
  p: FedParams,
): {
  gross: Cents;
  taxable: Cents;
  rollover: boolean;
  qcd: boolean;
  pso: boolean;
} {
  const gross = roundToDollar(r.box1GrossDistribution);
  const rawTaxable = roundToDollar(reportedTaxable(r));
  const codes = r.box7Codes.toUpperCase();
  const isCodeRollover = codes.includes('G') || codes.includes('H');
  const rolloverAmt = roundToDollar(r.rolloverAmount ?? 0);
  const qcdAmt = r.iraSepSimple ? Math.min(gross, roundToDollar(r.qcdAmount ?? 0)) : 0;
  const psoAmt = !r.iraSepSimple ? Math.min(p.psoMaxExclusion, roundToDollar(r.psoAmount ?? 0)) : 0;

  // When code G/H has box 2a = 0, the entire gross distribution is already a nontaxable direct rollover.
  // When the user reports a 60-day rollover or QCD/PSO that wasn't already subtracted from box 2a, subtract it here.
  const baseTaxable = isCodeRollover && rawTaxable === 0 ? 0 : rawTaxable;
  const taxable = Math.max(0, baseTaxable - rolloverAmt - qcdAmt - psoAmt);
  return {
    gross,
    taxable,
    rollover: isCodeRollover || rolloverAmt > 0,
    qcd: qcdAmt > 0,
    pso: psoAmt > 0,
  };
}

/** Form 1040 lines 4a–4c (IRA distributions) and 5a–5c (Pensions and annuities). */
export function retirementDistributions(
  f: TaxFacts,
  p: FedParams,
  l: Ledger,
): {
  line4a: Cents;
  line4b: Cents;
  line4c: { rollover: boolean; qcd: boolean };
  line5a: Cents;
  line5b: Cents;
  line5c: { rollover: boolean; pso: boolean };
} {
  const dists = f.f1099R ?? [];
  let line4a = 0;
  let line4b = 0;
  let line4Rollover = false;
  let line4Qcd = false;
  let line5a = 0;
  let line5b = 0;
  let line5Rollover = false;
  let line5Pso = false;

  const qcdLeft = new Map<string, Cents>(); // QCDs are tax-free only up to the limit per IRA owner
  for (const r of dists) {
    let dist = r;
    if (r.iraSepSimple && (r.qcdAmount ?? 0) > 0) {
      const left = qcdLeft.get(r.owner) ?? p.qcdLimit;
      const qcd = Math.min(roundToDollar(r.qcdAmount ?? 0), left);
      qcdLeft.set(r.owner, left - qcd);
      dist = { ...r, qcdAmount: qcd };
    }
    const d = taxableDistribution(dist, p);
    if (isIraDistribution(r)) {
      line4a += d.gross;
      line4b += d.taxable;
      if (d.rollover) line4Rollover = true;
      if (d.qcd) line4Qcd = true;
    } else {
      line5a += d.gross;
      line5b += d.taxable;
      if (d.rollover) line5Rollover = true;
      if (d.pso) line5Pso = true;
    }
  }

  l.set('f1040.4a', line4a, 'IRA distributions (gross)');
  l.set('f1040.4b', line4b, 'Taxable IRA distributions');
  l.set('f1040.5a', line5a, 'Pensions and annuities (gross)');
  l.set('f1040.5b', line5b, 'Taxable pensions and annuities');

  return {
    line4a,
    line4b,
    line4c: { rollover: line4Rollover, qcd: line4Qcd },
    line5a,
    line5b,
    line5c: { rollover: line5Rollover, pso: line5Pso },
  };
}

/** Social Security Benefits Worksheet — Form 1040 lines 6a and 6b (2025 Form 1040 instructions, p. 31). */
export function socialSecurityWorksheet(
  f: TaxFacts,
  otherIncomeBeforeSs: Cents,
  taxExemptInterest: Cents,
  adjustmentsBeforeDeductions: Cents,
  p: FedParams,
  l: Ledger,
): { line6a: Cents; line6b: Cents } {
  const ssa = f.ssa1099 ?? [];
  const netBenefits = roundToDollar(sumCents(ssa.map((x) => x.box5NetBenefits)));
  const L6a = l.set('f1040.6a', Math.max(0, netBenefits), 'Social Security benefits (SSA-1099 box 5)');
  if (L6a <= 0) {
    l.set('f1040.6b', 0, 'Taxable Social Security benefits');
    return { line6a: L6a, line6b: 0 };
  }

  const s = f.filingStatus;
  const ss = p.socialSecurityBenefits;
  const W1 = l.set('ssw.1', L6a, 'Net Social Security benefits');
  const W2 = l.set('ssw.2', rateToDollar(W1, ss.rate50), 'One-half of net Social Security benefits');
  const W3 = l.set('ssw.3', otherIncomeBeforeSs, 'Other income before Social Security');
  const W4 = l.set('ssw.4', taxExemptInterest, 'Tax-exempt interest');
  const W5 = l.set('ssw.5', W2 + W3 + W4, 'Combined income before adjustments');
  const W6 = l.set('ssw.6', adjustmentsBeforeDeductions, 'Adjustments to income');
  const W7 = l.set('ssw.7', W5 - W6, 'Provisional income');

  // If MFS and lived apart all year isn't set, MFS base threshold is $0 (85% of benefits up to provisional income).
  if (s === 'mfs') {
    const W16 = l.set('ssw.16', rateToDollar(Math.max(0, W7), ss.rate85), '85% of provisional income');
    const W17 = l.set('ssw.17', rateToDollar(W1, ss.rate85), '85% of net benefits');
    const L6b = l.set(
      'f1040.6b',
      l.set('ssw.18', Math.min(W16, W17), 'Taxable Social Security benefits'),
      'Taxable Social Security benefits',
    );
    return { line6a: L6a, line6b: L6b };
  }

  const W8 = l.set('ssw.8', ss.baseThreshold[s], 'Base amount for your filing status');
  if (W7 <= W8) {
    l.set('ssw.9', 0, 'Provisional income over base amount');
    l.set('ssw.18', 0, 'Taxable Social Security benefits');
    l.set('f1040.6b', 0, 'Taxable Social Security benefits');
    return { line6a: L6a, line6b: 0 };
  }

  const W9 = l.set('ssw.9', W7 - W8, 'Provisional income over base amount');
  const W10 = l.set('ssw.10', ss.upperThreshold[s] - ss.baseThreshold[s], '50% tier width ($12,000 MFJ / $9,000 others)');
  const W11 = l.set('ssw.11', Math.max(0, W9 - W10), 'Amount over upper threshold');
  const W12 = l.set('ssw.12', Math.min(W9, W10), 'Amount in 50% tier');
  const W13 = l.set('ssw.13', rateToDollar(W12, ss.rate50), 'One-half of line 12');
  const W14 = l.set('ssw.14', Math.min(W2, W13), 'Taxable benefits from 50% tier');
  const W15 = l.set('ssw.15', rateToDollar(W11, ss.rate85), '85% of amount over upper threshold');
  const W16 = l.set('ssw.16', W14 + W15, 'Lines 14 + 15');
  const W17 = l.set('ssw.17', rateToDollar(W1, ss.rate85), 'Maximum taxable (85% of net benefits)');
  const W18 = l.set('ssw.18', Math.min(W16, W17), 'Taxable Social Security benefits');
  const L6b = l.set('f1040.6b', W18, 'Taxable Social Security benefits');
  return { line6a: L6a, line6b: L6b };
}

/** Schedule 1-A (Form 1040) 2025 — Part I (MAGI) & Part V (Enhanced Deduction for Seniors) → Form 1040 line 13b. */
export interface Schedule1AResult {
  tips: Cents;
  overtime: Cents;
  carLoanInterest: Cents;
  /** Line 37. Only this part is added back for the AMT (Form 6251 line 1a). */
  senior: Cents;
  /** Line 38, to Form 1040 line 13b. */
  total: Cents;
}

/** The reduction steps of Parts II–IV: the amount less `step` for each $1,000 of MAGI over `start` (rounded down for
 *  tips and overtime, up for car loan interest). `ids` are the six lines from "Enter the amount from line 3" on. */
function reduceByIncome(
  l: Ledger,
  ids: [string, string, string, string, string, string],
  amount: Cents,
  magi: Cents,
  start: Cents,
  step: Cents,
  roundUp: boolean,
  label: string,
): Cents {
  const [lMagi, lStart, lOver, lCount, lCut, lResult] = ids;
  l.set(lMagi, magi, 'Modified adjusted gross income (line 3)');
  l.set(lStart, start, 'Income where the deduction starts to shrink');
  const over = l.set(lOver, Math.max(0, magi - start), 'Income over that amount');
  if (over <= 0) return l.set(lResult, amount, label);
  const thousands = roundUp ? Math.ceil(over / 100_000) : Math.floor(over / 100_000);
  l.set(lCount, thousands * 100, `Thousands of dollars over, rounded ${roundUp ? 'up' : 'down'} (a count, not dollars)`);
  const cut = l.set(lCut, thousands * step, 'Reduction');
  return l.set(lResult, Math.max(0, amount - cut), label);
}

/** Schedule 1-A (2025): Part II tips, Part III overtime, Part IV car loan interest and Part V the enhanced deduction
 *  for seniors. Married filing separately can't claim tips, overtime or the senior deduction; car loan interest it can. */
export function schedule1A(f: TaxFacts, agi: Cents, p: FedParams, l: Ledger): Schedule1AResult {
  const none: Schedule1AResult = { tips: 0, overtime: 0, carLoanInterest: 0, senior: 0, total: 0 };
  const fs = f.filingStatus;
  const s = p.schedule1A;
  const x = f.newDeductions;
  const tips = fs === 'mfs' ? 0 : roundToDollar(x?.tips ?? 0);
  const overtime = fs === 'mfs' ? 0 : roundToDollar(x?.overtime ?? 0);
  const loans = (x?.carLoans ?? []).filter((c) => c.interest > 0).slice(0, 2);
  const youSenior = fs !== 'mfs' && is65OrOlder(f.taxpayer.dateOfBirth) && hasValidSsn(f.taxpayer);
  const spouseSenior = fs === 'mfj' && Boolean(f.spouse && is65OrOlder(f.spouse.dateOfBirth) && hasValidSsn(f.spouse));
  if (tips <= 0 && overtime <= 0 && loans.length === 0 && !youSenior && !spouseSenior) return none;

  const L1 = l.set('sch1A.1', agi, 'Adjusted gross income (Form 1040, line 11b)');
  const L2e = l.set('sch1A.2e', 0, 'Foreign/territorial exclusions');
  const L3 = l.set('sch1A.3', L1 + L2e, 'Modified adjusted gross income (MAGI)');

  let L13 = 0;
  if (tips > 0) {
    l.set('sch1A.4a', f.w2s.length === 1 ? tips : 0, 'Qualified tips on Form W-2, box 7 (one employer)');
    l.set('sch1A.4b', 0, 'Qualified tips on Form 4137 (not filed)');
    const L4c = l.set('sch1A.4c', tips, 'Qualified tips received as an employee');
    const L6 = l.set('sch1A.6', L4c, 'Qualified tips', 'Lines 4c + 5');
    const L7 = l.set('sch1A.7', Math.min(L6, s.tipsCap), 'Qualified tips, up to $25,000');
    L13 = reduceByIncome(
      l,
      ['sch1A.8', 'sch1A.9', 'sch1A.10', 'sch1A.11', 'sch1A.12', 'sch1A.13'],
      L7,
      L3,
      s.tipsOvertimePhaseOutStart[fs],
      usd(100),
      false,
      'Qualified tips deduction',
    );
  }

  let L21 = 0;
  if (overtime > 0) {
    l.set('sch1A.14a', overtime, 'Qualified overtime compensation in Form W-2, box 1');
    const L14c = l.set('sch1A.14c', overtime, 'Qualified overtime compensation', 'Lines 14a + 14b');
    const L15 = l.set('sch1A.15', Math.min(L14c, s.overtimeCap[fs]), 'Qualified overtime, up to $12,500 ($25,000 joint)');
    L21 = reduceByIncome(
      l,
      ['sch1A.16', 'sch1A.17', 'sch1A.18', 'sch1A.19', 'sch1A.20', 'sch1A.21'],
      L15,
      L3,
      s.tipsOvertimePhaseOutStart[fs],
      usd(100),
      false,
      'Qualified overtime compensation deduction',
    );
  }

  let L30 = 0;
  if (loans.length > 0) {
    const rows = loans.map((c, i) => l.set(`sch1A.22${i === 0 ? 'a' : 'b'}`, roundToDollar(c.interest), `Loan interest, vehicle ${i + 1}`));
    const L23 = l.set('sch1A.23', sumCents(rows), 'Qualified passenger vehicle loan interest', 'Lines 22a + 22b, column (iii)');
    const L24 = l.set('sch1A.24', Math.min(L23, s.carLoanCap), 'Car loan interest, up to $10,000');
    L30 = reduceByIncome(
      l,
      ['sch1A.25', 'sch1A.26', 'sch1A.27', 'sch1A.28', 'sch1A.29', 'sch1A.30'],
      L24,
      L3,
      s.carLoanPhaseOutStart[fs],
      usd(200),
      true,
      'Qualified passenger vehicle loan interest deduction',
    );
  }

  let L37 = 0;
  if (youSenior || spouseSenior) {
    const sd = p.seniorDeduction;
    const L31 = l.set('sch1A.31', L3, 'MAGI (from Schedule 1-A, line 3)');
    const L32 = l.set('sch1A.32', sd.phaseOutStart[fs], 'Phase-out threshold ($150,000 MFJ / $75,000 others)');
    const L33 = l.set('sch1A.33', Math.max(0, L31 - L32), 'MAGI over threshold');
    const L34 = l.set('sch1A.34', L33 > 0 ? rateToDollar(L33, sd.phaseOutRate) : 0, '6% of excess MAGI');
    const perPerson = Math.max(0, sd.amountPerPerson - L34);
    if (L33 > 0) l.set('sch1A.35', perPerson, '$6,000 minus line 34');
    const L36a = l.set('sch1A.36a', youSenior ? perPerson : 0, 'Enhanced senior deduction (you)');
    const L36b = l.set('sch1A.36b', spouseSenior ? perPerson : 0, 'Enhanced senior deduction (spouse)');
    L37 = l.set('sch1A.37', L36a + L36b, 'Total enhanced deduction for seniors');
  }

  const total = l.set('sch1A.38', L13 + L21 + L30 + L37, 'Total additional deductions (Schedule 1-A, line 38)', 'Lines 13 + 21 + 30 + 37');
  return { tips: L13, overtime: L21, carLoanInterest: L30, senior: L37, total };
}
