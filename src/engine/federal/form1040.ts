import { sumCents, roundToDollar, type Cents } from '../money';
import { Ledger } from '../ledger';
import { FED_2025, type FedParams } from '../params/fed2025';
import { FED_2026 } from '../params/fed2026';
import type { TaxFacts } from '../../shared/facts';
import { scheduleA } from './scheduleA';
import { scheduleB } from './scheduleB';
import { otherSchedule1Income } from './schedule1';
import { computeBusinessAndSchedule1, type BusinessResult } from './business';
import { computeScheduleE, type ScheduleEOutput } from './scheduleE';
import {
  capitalLossCarryoverTo2026,
  computeScheduleD,
  scheduleDTaxWorksheet,
  type Form8949Sheet,
  type ScheduleDCheckboxes,
} from './scheduleD';
import { apportion, computeForm8995, type Form8995Result, type QbiBusiness } from './form8995';
import { qdcgWorksheet } from './qdcg';
import { taxOnOrdinaryIncome } from './taxComputation';
import { form8959 } from './form8959';
import { form8960 } from './form8960';
import { computeForm2210, type Form2210Result } from './form2210';
import { foreignTaxCredit, schedule3 } from './schedule3';
import { computeForm6251, type Form6251Result } from './form6251';
import { is65OrOlder, retirementDistributions, schedule1A, socialSecurityWorksheet } from './retirement';

export type FederalFormId =
  | 'f1040'
  | 'f1040v'
  | 'sch1'
  | 'sch1A'
  | 'sch2'
  | 'sch3'
  | 'f2210'
  | 'schA'
  | 'schB'
  | 'schC'
  | 'schD'
  | 'f8949'
  | 'schE'
  | 'schSE'
  | 'f4797'
  | 'f6251'
  | 'f8995'
  | 'f8995a'
  | 'f8995aSchA'
  | 'f8995aSchC'
  | 'f8959'
  | 'f8960'
  | 'f8582'
  | 'f8829'
  | 'f4562'
  | 'f7203'
  | 'f7206';

export interface FederalResult {
  ledger: Ledger;
  agi: Cents;
  taxableIncome: Cents;
  totalTax: Cents;
  totalPayments: Cents;
  /** Form 1040 line 35a (after the estimated tax penalty and any amount applied to next year). */
  refund: Cents;
  /** Form 1040 line 36. */
  appliedToNextYear: Cents;
  amountOwed: Cents;
  itemizing: boolean;
  /** Forms that must be printed/filed, in IRS attachment order. */
  forms: FederalFormId[];
  /** Form 6251 (alternative minimum tax). */
  amt: Form6251Result;
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
  /** Schedule E / Form 4562 / Form 8582 / Form 7203 computation details. */
  scheduleE: ScheduleEOutput;
  /** Form 8995 / 8995-A QBI computation details. */
  qbi: Form8995Result;
  /** Form 2210 underpayment penalty computation details. */
  form2210: Form2210Result;
}

/** The qualified trades or businesses for Form 8995 / 8995-A: the Schedule C business, then K-1 activities and rentals.
 *  The deductible part of SE tax reduces each source's QBI in proportion to its positive SE income. */
export function qbiBusinesses(f: TaxFacts, biz: BusinessResult, schE: ScheduleEOutput): QbiBusiness[] {
  const out: QbiBusiness[] = [];
  const b = biz.activeBusiness;
  if (b && biz.needsScheduleC) {
    const owner = b.owner === 'spouse' && f.spouse ? f.spouse : f.taxpayer;
    out.push({
      name: b.businessName || b.principalBusiness || `${owner.firstName} ${owner.lastName}`.trim(),
      tin: (b.ein ?? '').replace(/\D/g, '') || owner.ssn,
      isSstb: b.isSstb ?? true,
      qbi: biz.netQbi,
      w2Wages: roundToDollar(b.expenses.wages ?? 0),
      ubia: roundToDollar(b.ubiaOfQualifiedProperty ?? 0),
      active: b.materialParticipation ?? true,
      sourceId: b.id,
    });
  }
  const k1s = f.k1s ?? [];
  const shares = apportion(
    biz.seTaxForK1s,
    k1s.map((k) => Math.max(0, roundToDollar(k.selfEmploymentEarnings ?? 0))),
  );
  const seShare = new Map(k1s.map((k, n) => [k.id, shares[n]!]));
  for (const e of schE.qbiEntries) out.push({ ...e, qbi: e.qbi - (e.sourceId ? (seShare.get(e.sourceId) ?? 0) : 0) });
  return out;
}

/** Form 1040 (2025 / 2026) for the Phase-1..A7 scope. Pure: same facts in → same lines out. */
export function computeFederal(f: TaxFacts, p: FedParams = f.taxYear === 2026 ? FED_2026 : FED_2025): FederalResult {
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
  const L3a = l.set(
    'f1040.3a',
    sumCents([...f.f1099Div.map((x) => x.box1bQualifiedDividends), ...(f.k1s ?? []).map((k) => roundToDollar(k.qualifiedDividends))]),
    'Qualified dividends',
  );
  const L3b = l.set('f1040.3b', b.ordinaryDividends, 'Ordinary dividends');
  const ret = retirementDistributions(f, p, l);
  const L4b = ret.line4b;
  const L5b = ret.line5b;
  const biz0 = computeBusinessAndSchedule1(f, p, l);
  // Schedule 1 lines 1 and 7 (taxable state refund, unemployment) join line 10 with the business lines.
  const s1Other = otherSchedule1Income(f, p, l);
  const biz =
    s1Other.line1 + s1Other.line7 === 0
      ? biz0
      : {
          ...biz0,
          needsSchedule1: true,
          schedule1AdditionalIncome: l.set(
            'sch1.10',
            biz0.schedule1AdditionalIncome + s1Other.line1 + s1Other.line7,
            'Additional income',
            'Lines 1 through 7 and 9',
          ),
        };

  // Compute preliminary Schedule D without S-corp excess distribution gain first to get MAGI before passive loss for Form 8582 line 6
  const prelimScorpGain = sumCents(
    (f.k1s ?? [])
      .filter((k) => k.entityType === '1120S' && k.sCorpBasis)
      .map((k) => {
        const b = k.sCorpBasis!;
        const inc =
          Math.max(0, roundToDollar(k.ordinaryBusinessIncome)) +
          Math.max(0, roundToDollar(k.netRentalRealEstateIncome)) +
          Math.max(0, roundToDollar(k.otherNetRentalIncome ?? 0)) +
          Math.max(0, roundToDollar(k.interestIncome)) +
          Math.max(0, roundToDollar(k.ordinaryDividends)) +
          Math.max(0, roundToDollar(k.royalties ?? 0)) +
          Math.max(0, roundToDollar(k.netShortTermCapitalGain) + roundToDollar(k.netLongTermCapitalGain)) +
          Math.max(0, roundToDollar(k.netSection1231Gain));
        const stockBeforeDist = roundToDollar(b.beginningStockBasis) + roundToDollar(b.capitalContributions ?? 0) + inc;
        return Math.max(0, roundToDollar(b.distributions ?? 0) - stockBeforeDist);
      }),
  );
  const d = computeScheduleD(f, L3a, p, l, biz.form4797.scheduleDLine11, prelimScorpGain);
  const L7a = l.set('f1040.7a', d.line7a, 'Capital gain or (loss)');
  l.set('f1040.7', L7a, 'Capital gain or (loss)');

  // Form 8582 line 6 MAGI = AGI before passive income/loss, taxable Social Security, and deductible half of SE tax
  const magiBeforePassive =
    L1z + L2b + L3b + L4b + L5b + L7a + biz.schedule1AdditionalIncome - (biz.schedule1Adjustments - biz.deductibleSeTax);
  const schE = computeScheduleE(f, l, magiBeforePassive);
  const s1Line10 = schE.needsScheduleE
    ? l.set('sch1.10', biz.schedule1AdditionalIncome + schE.netScheduleEIncome, 'Additional income (Schedule 1, line 10)')
    : biz.schedule1AdditionalIncome;
  const L8 = l.set('f1040.8', s1Line10, 'Additional income (Schedule 1)');
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
  const rawItemized = scheduleA(f, L11b, p, l, biz.homeOfficeScheduleAReduction);
  const s1a = schedule1A(f, L11b, p, l);
  const seniorDed13b = s1a.total; // all of Schedule 1-A line 38: tips, overtime, car loan interest and seniors

  // 2026+ §68 as amended by OBBBA §70111: itemized deductions are reduced by 2/37 of the lesser of the itemized
  // deductions, or taxable income figured without this rule and *increased by* the itemized deductions, over the start
  // of the 37% bracket. That income is line 11b less the line 13b deductions and the QBI deduction (figured with the
  // full itemized deductions, in a scratch ledger).
  let itemized = rawItemized;
  if (p.itemizedTopBracketLimit.enabled && rawItemized > 0) {
    const start37 = p.itemizedTopBracketLimit.bracket37Start[f.filingStatus];
    const qbiWithoutLimit = computeForm8995(
      f,
      {
        taxableIncomeBeforeQbi: Math.max(0, L11b - rawItemized - seniorDed13b),
        netCapitalGainAndQualifiedDividends: L3a + d.netCapitalGain,
        businesses: qbiBusinesses(f, biz, schE),
      },
      p,
      new Ledger(),
    ).deduction;
    const excessOver37 = Math.max(0, L11b - seniorDed13b - qbiWithoutLimit - start37);
    if (excessOver37 > 0) {
      const reduction = roundToDollar(Math.round((Math.min(rawItemized, excessOver37) * 2) / 37));
      l.set('schA.17.limit37', reduction, '37% bracket itemized deduction reduction (OBBBA §70111, 2/37 rule)');
      itemized = l.set('schA.17', Math.max(0, rawItemized - reduction), 'Total itemized deductions (after 37% bracket limit)');
    }
  }

  // 2026+ OBBBA §70424: Non-itemizer cash charitable deduction (up to $1,000 single/MFS/HOH, $2,000 MFJ/QSS)
  const nonItemizerCharityCap = p.charitable.nonItemizerCap[f.filingStatus];
  const nonItemizerCharity = nonItemizerCharityCap > 0 ? Math.min(roundToDollar(f.itemized.charityCash), nonItemizerCharityCap) : 0;

  const itemizing = f.forceItemize || itemized > standard + nonItemizerCharity;
  const L12e = l.set('f1040.12e', itemizing ? itemized : standard, itemizing ? 'Itemized deductions (Schedule A)' : 'Standard deduction');
  if (!itemizing && nonItemizerCharity > 0) {
    l.set('f1040.12b', nonItemizerCharity, 'Charitable contributions if you take the standard deduction (OBBBA §70424)');
  }
  const L13b = l.set(
    'f1040.13b',
    seniorDed13b + (!itemizing ? nonItemizerCharity : 0),
    'Additional deductions (Schedule 1-A / non-itemizer charitable)',
  );
  const qbi = computeForm8995(
    f,
    {
      taxableIncomeBeforeQbi: Math.max(0, L11b - L12e - L13b),
      netCapitalGainAndQualifiedDividends: L3a + d.netCapitalGain,
      businesses: qbiBusinesses(f, biz, schE),
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
  foreignTaxCredit(f, L16, l); // Schedule 3 line 1, needed by Form 6251 line 8

  const passiveK1s = (f.k1s ?? []).filter((k) => !k.isMaterialParticipation);
  const amt = computeForm6251(
    f,
    {
      itemizing,
      schedule1A: s1a.senior, // only line 37 is added back for the AMT (Form 6251 line 1a)
      stateRefundIncome: l.get('sch1.1'),
      passiveAdjustments: sumCents(passiveK1s.map((k) => (k.amtDepreciationAdjustment ?? 0) + (k.amtGainLossAdjustment ?? 0))),
      passiveLossLimited: schE.passiveLossCarryoverTo2026 > 0,
      worksheet: usesSdtw ? 'sdtw' : usesQdcg ? 'qdcg' : 'none',
      foreignTaxCredit: l.get('sch3.1'),
    },
    p,
    l,
  );
  const medicare = form8959(f, p, l, biz.seNetEarnings);
  const k1Mp1231 = sumCents((f.k1s ?? []).filter((k) => k.isMaterialParticipation).map((k) => roundToDollar(k.netSection1231Gain)));
  const business4797 = biz.form4797.schedule1Line4 + biz.form4797.scheduleDLine11 - schE.k1NetSection1231Gain;
  const niit = form8960(
    {
      taxableInterest: L2b,
      ordinaryDividends: L3b,
      nonqualifiedAnnuities: sumCents(
        (f.f1099R ?? []).filter((x) => x.box7Codes.includes('D')).map((x) => roundToDollar(x.box2aTaxableAmount)),
      ),
      scheduleCAndE: l.get('sch1.3') + (schE.needsScheduleE ? schE.netScheduleEIncome : 0),
      nonInvestmentBusinessIncome: l.get('sch1.3') + schE.nonInvestmentIncome,
      dispositions: L7a + l.get('sch1.4'),
      nonInvestmentDispositions: (biz.activeBusiness ? business4797 : 0) + k1Mp1231,
      allowedStateIncomeTax: itemizing ? l.get('schA.5a.allowed') : 0,
      magi: L11b,
    },
    f.filingStatus,
    p,
    l,
  );
  const S2_2 = l.set('sch2.2', amt.amt, 'Alternative minimum tax (Form 6251)');
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
      ...(f.f1099G ?? []).map((x) => x.box4FedWithheld),
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
  const f2210 = computeForm2210(
    f,
    {
      line22TaxAfterCredits: L22,
      line2OtherTaxes: S2_21,
      line3RefundableCredits: 0,
      line6Withholding: L25d + l.get('sch3.11'),
    },
    l,
  );
  const L38 = l.set('f1040.38', f2210.penalty, 'Estimated tax penalty (Form 2210)');
  // 2025 Form 1040 instructions, line 38: the penalty comes out of an overpayment first. Lines 35a, 36 and 38 equal
  // line 34; a penalty larger than the overpayment leaves 35a and 36 at zero and the difference owed on line 37.
  const available = Math.max(0, L34 - L38);
  const want36 = f.payments.applyToNextYear === 'all' ? available : roundToDollar(Math.max(0, f.payments.applyToNextYear ?? 0));
  const L36 = l.set('f1040.36', Math.min(available, want36), `Applied to your ${f.taxYear + 1} estimated tax`);
  const L35a = l.set('f1040.35a', available - L36, 'Refund', 'Line 34 − line 36 − line 38');
  const L37 = l.set(
    'f1040.37',
    L34 > 0 ? Math.max(0, L38 - L34) : Math.max(0, L24 - L33) + L38,
    'Amount you owe',
    L34 > 0 ? 'Line 38 − line 34' : 'Line 24 − line 33 + line 38',
  );

  const foreign = f.foreignAccounts.hasForeignAccount === true || f.foreignAccounts.foreignTrust === true;
  // Attachment Sequence No. order:
  // 1040, Sch 1 (01), Sch 1-A (01A), Sch 2 (02), Sch 3 (03), 2210 (06), Sch A (07), Sch B (08), Sch C (09), Sch D (12), 8949 (12A),
  // Sch E (13), Sch SE (17), 4797 (27), 6251 (32), 8995 (55), 8995-A (55A) with its Schedules A (55B) and C (55D), 8959 (71), 8960 (72), 8582 (858), 8829 (176), 4562 (179), 7203 (203), 7206 (206).
  const forms: FederalFormId[] = ['f1040'];
  if (biz.needsSchedule1 || schE.needsScheduleE) forms.push('sch1');
  if (L13b > 0) forms.push('sch1A');
  if (S2_3 > 0 || S2_21 > 0) forms.push('sch2');
  if (s3.nonrefundableCredits > 0 || s3.otherPayments > 0) forms.push('sch3');
  if (f2210.needsForm2210) forms.push('f2210');
  if (itemizing) forms.push('schA');
  if (L2b > p.scheduleBThreshold || L3b > p.scheduleBThreshold || foreign) forms.push('schB');
  if (biz.needsScheduleC) forms.push('schC');
  if (d.needsScheduleD) forms.push('schD');
  if (d.needsForm8949) forms.push('f8949');
  if (schE.needsScheduleE) forms.push('schE');
  if (biz.needsScheduleSE) forms.push('schSE');
  if (biz.needsForm4797) forms.push('f4797');
  if (amt.needsForm6251) forms.push('f6251');
  if (qbi.form === 'f8995') forms.push('f8995');
  if (qbi.form === 'f8995a') forms.push('f8995a');
  if (qbi.form === 'f8995a' && qbi.needsScheduleA) forms.push('f8995aSchA');
  if (qbi.form === 'f8995a' && qbi.needsScheduleC) forms.push('f8995aSchC');
  if (medicare.tax > 0 || medicare.withholding > 0) forms.push('f8959');
  if (niit > 0) forms.push('f8960');
  if (schE.needsForm8582) forms.push('f8582');
  if (biz.needsForm8829) forms.push('f8829');
  if (schE.needsForm4562) forms.push('f4562');
  if (schE.needsForm7203) forms.push('f7203');
  if (biz.needsForm7206) forms.push('f7206');
  if (L37 > 0) forms.push('f1040v');

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
    refund: L35a,
    appliedToNextYear: L36,
    amountOwed: L37,
    itemizing,
    forms,
    amt,
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
    scheduleE: schE,
    qbi,
    form2210: f2210,
  };
}
