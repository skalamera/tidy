import { sumCents, type Cents } from '../money';
import { Ledger } from '../ledger';
import { FED_2025, type FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';
import { scheduleA } from './scheduleA';
import { scheduleB } from './scheduleB';
import { computeBusinessAndSchedule1, type BusinessResult } from './business';
import {
  capitalLossCarryoverTo2026,
  computeScheduleD,
  scheduleDTaxWorksheet,
  type Form8949Sheet,
  type ScheduleDCheckboxes,
} from './scheduleD';
import { computeForm8995 } from './form8995';
import { qdcgWorksheet } from './qdcg';
import { taxOnOrdinaryIncome } from './taxComputation';
import { form8959 } from './form8959';
import { form8960 } from './form8960';
import { schedule3 } from './schedule3';
import { amtScreen } from './amtScreen';
import { is65OrOlder, retirementDistributions, schedule1A, socialSecurityWorksheet } from './retirement';

export type FederalFormId =
  | 'f1040'
  | 'sch1'
  | 'sch1A'
  | 'sch2'
  | 'sch3'
  | 'schA'
  | 'schB'
  | 'schC'
  | 'schD'
  | 'f8949'
  | 'schSE'
  | 'f4797'
  | 'f8995'
  | 'f8995a'
  | 'f8959'
  | 'f8960'
  | 'f8829'
  | 'f7206';

export interface FederalResult {
  ledger: Ledger;
  agi: Cents;
  taxableIncome: Cents;
  totalTax: Cents;
  totalPayments: Cents;
  refund: Cents;
  amountOwed: Cents;
  itemizing: boolean;
  /** Forms that must be printed/filed, in IRS attachment order. */
  forms: FederalFormId[];
  /** True when the AMT screen can't rule out alternative minimum tax (Form 6251 isn't supported yet). */
  mayOweAmt: boolean;
  /** Schedule B Parts I and II rows. */
  payers: { interest: { name: string; amount: Cents }[]; dividends: { name: string; amount: Cents }[] };
  /** Form 1040 line 4c checkboxes (Rollover, QCD). */
  line4c: { rollover: boolean; qcd: boolean };
  /** Form 1040 line 5c checkboxes (Rollover, PSO). */
  line5c: { rollover: boolean; pso: boolean };
  /** Form 1040 line 7b checkbox ("If you are not required to file Schedule D, check here"). */
  line7bCheck: boolean;
  /** Form 1040 line 12d checkboxes (65+ and blind for taxpayer and spouse). */
  line12d: { you65: boolean; youBlind: boolean; spouse65: boolean; spouseBlind: boolean };
  /** Paginated Form 8949 sheets (11 rows per page per Part). */
  form8949Sheets: Form8949Sheet[];
  /** Schedule D checkboxes (QOF, lines 17, 20, 22). */
  scheduleDCheckboxes: ScheduleDCheckboxes;
  /** Capital loss carryover from 2025 to 2026 (computed via the 2025 Capital Loss Carryover Worksheet). */
  capitalLossCarryoverTo2026: { shortTerm: Cents; longTerm: Cents };
  /** Section 199A QBI / REIT / PTP loss carryforwards from 2025 to 2026. */
  qbiCarryforwardTo2026: { qbiLoss: Cents; reitPtpLoss: Cents };
  /** Schedule C / SE / 8829 / 7206 / 4797 computation details. */
  business: BusinessResult;
}

/** Form 1040 (2025) for the Phase-1 scope. Pure: same facts in → same lines out. */
export function computeFederal(f: TaxFacts, p: FedParams = FED_2025): FederalResult {
  const l = new Ledger();

  // Income (page 1)
  const L1a = l.set('f1040.1a', sumCents(f.w2s.map((w) => w.box1Wages)), 'Wages from W-2s (box 1)');
  const L1z = l.set('f1040.1z', L1a, 'Total wages', 'Lines 1a through 1h');
  const b = scheduleB(f, l);
  const L2a = l.set(
    'f1040.2a',
    sumCents([...f.f1099Int.map((x) => x.box8TaxExemptInterest), ...f.f1099Div.map((x) => x.box12ExemptInterestDividends)]),
    'Tax-exempt interest',
  );
  const L2b = l.set('f1040.2b', b.taxableInterest, 'Taxable interest');
  const L3a = l.set('f1040.3a', sumCents(f.f1099Div.map((x) => x.box1bQualifiedDividends)), 'Qualified dividends');
  const L3b = l.set('f1040.3b', b.ordinaryDividends, 'Ordinary dividends');
  const ret = retirementDistributions(f, p, l);
  const L4b = ret.line4b;
  const L5b = ret.line5b;
  const biz = computeBusinessAndSchedule1(f, p, l);
  const d = computeScheduleD(f, L3a, p, l, biz.form4797.scheduleDLine11);
  const L7a = l.set('f1040.7a', d.line7a, 'Capital gain or (loss)');
  const L8 = l.set('f1040.8', biz.schedule1AdditionalIncome, 'Additional income (Schedule 1)');
  const L10 = l.set('f1040.10', biz.schedule1Adjustments, 'Adjustments to income (Schedule 1)');
  const otherIncomeBeforeSs = L1z + L2b + L3b + L4b + L5b + L7a + L8;
  const ss = socialSecurityWorksheet(f, otherIncomeBeforeSs, L2a, L10, p, l);
  const L6b = ss.line6b;
  const L9 = l.set('f1040.9', otherIncomeBeforeSs + L6b, 'Total income', 'Lines 1z + 2b + 3b + 4b + 5b + 6b + 7a + 8');
  const L11a = l.set('f1040.11a', L9 - L10, 'Adjusted gross income', 'Line 9 − line 10');

  // Deductions (page 2)
  const L11b = l.set('f1040.11b', L11a, 'Adjusted gross income');
  const you65 = is65OrOlder(f.taxpayer.dateOfBirth);
  const youBlind = Boolean(f.taxpayer.blind);
  const hasSpouseOnReturn = f.filingStatus === 'mfj' && f.spouse !== null;
  const spouse65 = hasSpouseOnReturn && is65OrOlder(f.spouse!.dateOfBirth);
  const spouseBlind = hasSpouseOnReturn && Boolean(f.spouse!.blind);
  const extraBoxes = (you65 ? 1 : 0) + (youBlind ? 1 : 0) + (spouse65 ? 1 : 0) + (spouseBlind ? 1 : 0);
  const extraPerBox =
    f.filingStatus === 'single' || f.filingStatus === 'hoh'
      ? p.additionalStandardDeduction65OrBlind.singleOrHoh
      : p.additionalStandardDeduction65OrBlind.marriedOrQss;
  const standard = p.standardDeduction[f.filingStatus] + extraBoxes * extraPerBox;
  const itemized = scheduleA(f, L11b, p, l, biz.homeOfficeScheduleAReduction);
  const itemizing = f.forceItemize || itemized > standard;
  const L12e = l.set('f1040.12e', itemizing ? itemized : standard, itemizing ? 'Itemized deductions (Schedule A)' : 'Standard deduction');
  const L13b = l.set('f1040.13b', schedule1A(f, L11b, p, l), 'Additional deductions (Schedule 1-A)');
  const qbi = computeForm8995(
    f,
    {
      taxableIncomeBeforeQbi: Math.max(0, L11b - L12e - L13b),
      netCapitalGainAndQualifiedDividends: L3a + d.netCapitalGain,
      tradeOrBusinessQbi: biz.netQbi,
      isSstb: biz.activeBusiness?.isSstb ?? true,
      businessW2Wages: biz.activeBusiness?.expenses.wages ?? 0,
    },
    p,
    l,
  );
  const L13a = l.set('f1040.13a', qbi.deduction, 'Qualified business income deduction');
  const L14 = l.set('f1040.14', L12e + L13a + L13b, 'Total deductions', 'Lines 12e + 13a + 13b');
  const L15 = l.set('f1040.15', Math.max(0, L11b - L14), 'Taxable income', 'Line 11b − line 14');

  // Tax
  const usesSdtw = d.usesScheduleDTaxWorksheet;
  const usesQdcg = !usesSdtw && (L3a > 0 || d.netCapitalGain > 0);
  const tax = usesSdtw
    ? scheduleDTaxWorksheet(
        {
          taxableIncome: L15,
          qualifiedDividends: L3a,
          schD15: l.get('schD.15'),
          schD16: l.get('schD.16'),
          schD18: l.get('schD.18'),
          schD19: l.get('schD.19'),
        },
        f.filingStatus,
        p,
        l,
      )
    : usesQdcg
      ? qdcgWorksheet({ taxableIncome: L15, qualifiedDividends: L3a, netCapitalGainForWorksheet: d.netCapitalGain }, f.filingStatus, p, l)
      : taxOnOrdinaryIncome(L15, f.filingStatus, p);
  const L16 = l.set('f1040.16', tax, 'Income tax');

  const { mayOweAmt } = amtScreen(f, itemizing, p, l);
  const medicare = form8959(f, p, l, biz.seNetEarnings);
  const niit = form8960({ taxableInterest: L2b, ordinaryDividends: L3b, netGain: L7a, magi: L11b }, f.filingStatus, p, l);
  const S2_2 = l.set('sch2.2', 0, 'Alternative minimum tax (Form 6251)');
  const S2_3 = l.set('sch2.3', S2_2, 'Total additions to tax', 'Lines 1z + 2');
  const S2_4 = l.set('sch2.4', biz.seTax, 'Self-employment tax (Schedule SE)');
  const S2_11 = l.set('sch2.11', medicare.tax, 'Additional Medicare Tax (Form 8959)');
  const S2_12 = l.set('sch2.12', niit, 'Net investment income tax (Form 8960)');
  const S2_21 = l.set('sch2.21', S2_4 + S2_11 + S2_12, 'Total other taxes');
  const s3 = schedule3(f, p, l);

  const L17 = l.set('f1040.17', S2_3, 'Additional tax (Schedule 2, line 3)');
  const L18 = l.set('f1040.18', L16 + L17, 'Tax before credits', 'Lines 16 + 17');
  const L19 = l.set('f1040.19', 0, 'Child tax credit / credit for other dependents');
  const L20 = l.set('f1040.20', s3.nonrefundableCredits, 'Other credits (Schedule 3, line 8)');
  const L21 = l.set('f1040.21', L19 + L20, 'Total credits', 'Lines 19 + 20');
  const L22 = l.set('f1040.22', Math.max(0, L18 - L21), 'Tax after credits', 'Line 18 − line 21');
  const L23 = l.set('f1040.23', S2_21, 'Other taxes (Schedule 2, line 21)');
  const L24 = l.set('f1040.24', L22 + L23, 'Total tax', 'Lines 22 + 23');

  // Payments
  const L25a = l.set('f1040.25a', sumCents(f.w2s.map((w) => w.box2FedWithheld)), 'Federal tax withheld (W-2s)');
  const L25b = l.set(
    'f1040.25b',
    sumCents([
      ...f.f1099Int.map((x) => x.box4FedWithheld),
      ...f.f1099Div.map((x) => x.box4FedWithheld),
      ...(f.f1099B ?? []).map((x) => x.box4FedWithheld),
      ...(f.f1099R ?? []).map((x) => x.box4FedWithheld),
      ...(f.f1099Nec ?? []).map((x) => x.box4FedWithheld),
      ...(f.ssa1099 ?? []).map((x) => x.box6FedWithheld),
    ]),
    'Federal tax withheld (1099s)',
  );
  const L25c = l.set('f1040.25c', medicare.withholding, 'Additional Medicare Tax withheld (Form 8959)');
  const L25d = l.set('f1040.25d', L25a + L25b + L25c, 'Total federal tax withheld');
  const L26 = l.set(
    'f1040.26',
    sumCents(f.payments.federalEstimated) + f.payments.federalPriorYearApplied,
    'Estimated payments and last year’s refund applied',
  );
  const L31 = l.set('f1040.31', s3.otherPayments, 'Other payments (Schedule 3, line 15)');
  const L32 = l.set('f1040.32', L31, 'Other payments and refundable credits');
  const L33 = l.set('f1040.33', L25d + L26 + L32, 'Total payments', 'Lines 25d + 26 + 32');
  const L34 = l.set('f1040.34', Math.max(0, L33 - L24), 'Overpaid', 'Line 33 − line 24');
  l.set('f1040.35a', L34, 'Refund');
  const L37 = l.set('f1040.37', Math.max(0, L24 - L33), 'Amount you owe', 'Line 24 − line 33');

  const foreign = f.foreignAccounts.hasForeignAccount === true || f.foreignAccounts.foreignTrust === true;
  // Attachment Sequence No. order:
  // 1040, Sch 1 (01), Sch 1-A (01A), Sch 2 (02), Sch 3 (03), Sch A (07), Sch B (08), Sch C (09), Sch D (12), 8949 (12A),
  // Sch SE (17), 4797 (27), 8995 (55), 8995-A (55A), 8959 (71), 8960 (72), 8829 (176), 7206 (206).
  const forms: FederalFormId[] = ['f1040'];
  if (biz.needsSchedule1) forms.push('sch1');
  if (L13b > 0) forms.push('sch1A');
  if (S2_3 > 0 || S2_21 > 0) forms.push('sch2');
  if (s3.nonrefundableCredits > 0 || s3.otherPayments > 0) forms.push('sch3');
  if (itemizing) forms.push('schA');
  if (L2b > p.scheduleBThreshold || L3b > p.scheduleBThreshold || foreign) forms.push('schB');
  if (biz.needsScheduleC) forms.push('schC');
  if (d.needsScheduleD) forms.push('schD');
  if (d.needsForm8949) forms.push('f8949');
  if (biz.needsScheduleSE) forms.push('schSE');
  if (biz.needsForm4797) forms.push('f4797');
  if (qbi.form === 'f8995') forms.push('f8995');
  if (qbi.form === 'f8995a') forms.push('f8995a');
  if (medicare.tax > 0 || medicare.withholding > 0) forms.push('f8959');
  if (niit > 0) forms.push('f8960');
  if (biz.needsForm8829) forms.push('f8829');
  if (biz.needsForm7206) forms.push('f7206');

  const carryoverTo2026 = capitalLossCarryoverTo2026({
    agi: L11b,
    totalDeductions: L14,
    schD7: l.get('schD.7'),
    schD15: l.get('schD.15'),
    schD21: l.get('schD.21'),
  });

  return {
    ledger: l,
    agi: L11a,
    taxableIncome: L15,
    totalTax: L24,
    totalPayments: L33,
    refund: L34,
    amountOwed: L37,
    itemizing,
    forms,
    mayOweAmt,
    payers: { interest: b.interestPayers, dividends: b.dividendPayers },
    line4c: ret.line4c,
    line5c: ret.line5c,
    line7bCheck: d.line7bCheck,
    line12d: { you65, youBlind, spouse65, spouseBlind },
    form8949Sheets: d.form8949Sheets,
    scheduleDCheckboxes: d.checkboxes,
    capitalLossCarryoverTo2026: carryoverTo2026,
    qbiCarryforwardTo2026: qbi.carryforwardTo2026,
    business: biz,
  };
}
