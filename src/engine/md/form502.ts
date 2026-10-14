import { roundToDollar, sumCents, usd, type Cents } from '../money';
import { Ledger } from '../ledger';
import { FED_2025 } from '../params/fed2025';
import { MD_2025, type MdCounty, type MdParams } from '../params/md2025';
import type { FederalResult } from '../federal/form1040';
import { taxableDistribution } from '../federal/retirement';
import { ownerScheduleCIncome } from '../federal/business';
import { ownerScheduleEIncome } from '../federal/scheduleE';
import { normalizeLot } from '../federal/scheduleD';
import type { Form1099R, Owner, Person, TaxFacts } from '../../shared/facts';
import { mdCapitalGainSurtax, mdExemptionValue, mdItemizedPhaseOut, mdLocalTax, mdStateTax } from './mdTax';

export type MdFormId = 'md502' | 'md502su' | 'md502cg' | 'md502r' | 'md502cr' | 'md500dm';

export interface MdResult {
  ledger: Ledger;
  itemizing: boolean;
  totalTax: Cents;
  totalPayments: Cents;
  refund: Cents;
  amountOwed: Cents;
  /** Flat local rate as printed after ".0" on line 28 (e.g. "320" for 3.20%), or null for bracket counties. */
  localRatePrinted: string | null;
  exemptions: { you: boolean; spouse: boolean; age65: number; blind: number; extra: number; total: number };
  /** Checkboxes on Form 502 line 10a ("Yourself", "Spouse") when claiming the Worksheet 13A pension exclusion. */
  pensionExclusion: { you: boolean; spouse: boolean };
  forms: MdFormId[];
  needsForm500DM: boolean;
  needsForm502SU: boolean;
}

/** Born before January 2, 1961 = 65 or older at the end of 2025 (same test as Form 1040 line 12d). */
export const is65 = (dob: string | null | undefined) => Boolean(dob && dob < '1961-01-02');

/** Age at December 31, 2025 for Form 502R Part 2 (born Jan 1, 1961 counts as 65). */
export function ageAtEndOf2025(dob: string | null | undefined): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  if (dob === '1961-01-01') return 65;
  const year = Number.parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(year) && year > 1900 && year <= 2025 ? 2025 - year : null;
}

const qualifiesForPensionExclusion = (person: Person | null | undefined): boolean =>
  Boolean(person && (is65(person.dateOfBirth) || person.totallyDisabled));

/** Taxable amount of one 1099-R included in federal AGI. */
const fedTaxable1099R = (r: Form1099R): Cents => taxableDistribution(r, FED_2025).taxable;

/** Form 502R Part 4 — retirement income by spouse and source, plus Worksheet 13A (line 10a). */
function compute502RAndPensionExclusion(
  f: TaxFacts,
  p: MdParams,
  l: Ledger,
): {
  line1d: Cents;
  line10a: Cents;
  youExcluded: Cents;
  spouseExcluded: Cents;
  youSsNet: Cents;
  spouseSsNet: Cents;
  needs502R: boolean;
} {
  const dists = f.f1099R ?? [];
  const ssa = f.ssa1099 ?? [];

  const byOwnerAndSource = (who: Owner, pred: (r: Form1099R) => boolean) =>
    sumCents(dists.filter((r) => r.owner === who && pred(r)).map(fedTaxable1099R));

  // Part 4 lines 1a/1b: Employee retirement system (qualified 401(a), 401(k), 403(b), 457(b), defined-benefit pensions)
  const L1a = byOwnerAndSource('taxpayer', (r) => !r.iraSepSimple && (r.mdSource ?? 'qualified_plan') === 'qualified_plan');
  const L1b = byOwnerAndSource('spouse', (r) => !r.iraSepSimple && (r.mdSource ?? 'qualified_plan') === 'qualified_plan');
  // Lines 3a/3b: Military retirement income
  const L3a = byOwnerAndSource('taxpayer', (r) => !r.iraSepSimple && r.mdSource === 'military');
  const L3b = byOwnerAndSource('spouse', (r) => !r.iraSepSimple && r.mdSource === 'military');
  // Lines 4a/4b: Public safety employee retirement income
  const L4a = byOwnerAndSource('taxpayer', (r) => !r.iraSepSimple && r.mdSource === 'public_safety');
  const L4b = byOwnerAndSource('spouse', (r) => !r.iraSepSimple && r.mdSource === 'public_safety');
  // Lines 7a/7b: Traditional, Rollover, SEP, SIMPLE IRAs, non-qualified plans (DO NOT qualify for Worksheet 13A!)
  const L7a = byOwnerAndSource('taxpayer', (r) => r.iraSepSimple || r.mdSource === 'other');
  const L7b = byOwnerAndSource('spouse', (r) => r.iraSepSimple || r.mdSource === 'other');

  const L8 = L1a + L1b + L3a + L3b + L4a + L4b + L7a + L7b;

  // Part 5 lines 9a/9b & 10a/10b: Total net Social Security benefits (SSA-1099 box 5) by spouse
  const youSsNet = Math.max(0, roundToDollar(sumCents(ssa.filter((x) => x.owner === 'taxpayer').map((x) => x.box5NetBenefits))));
  const spouseSsNet = Math.max(0, roundToDollar(sumCents(ssa.filter((x) => x.owner === 'spouse').map((x) => x.box5NetBenefits))));

  // Worksheet 13A: Qualifying pension income (employee retirement systems only — IRAs excluded)
  const youQualifyingPension = L1a + L3a + L4a;
  const spouseQualifyingPension = L1b + L3b + L4b;

  const youEligible = qualifiesForPensionExclusion(f.taxpayer);
  const spouseEligible = f.filingStatus === 'mfj' && qualifiesForPensionExclusion(f.spouse);

  const youMax = youEligible ? Math.max(0, p.pensionExclusionMax - youSsNet) : 0;
  const spouseMax = spouseEligible ? Math.max(0, p.pensionExclusionMax - spouseSsNet) : 0;

  const youExcluded = youEligible ? Math.min(youQualifyingPension, youMax) : 0;
  const spouseExcluded = spouseEligible ? Math.min(spouseQualifyingPension, spouseMax) : 0;
  const line10a = youExcluded + spouseExcluded;

  const needs502R = L8 > 0 || line10a > 0 || youSsNet + spouseSsNet > 0;
  if (needs502R) {
    l.set('md502r.1a', L1a, 'Employee retirement system (you)');
    l.set('md502r.1b', L1b, 'Employee retirement system (spouse)');
    if (L3a > 0 || L3b > 0) {
      l.set('md502r.3a', L3a, 'Military retirement income (you)');
      l.set('md502r.3b', L3b, 'Military retirement income (spouse)');
    }
    if (L4a > 0 || L4b > 0) {
      l.set('md502r.4a', L4a, 'Public safety retirement income (you)');
      l.set('md502r.4b', L4b, 'Public safety retirement income (spouse)');
    }
    l.set('md502r.7a', L7a, 'Traditional, SEP, or SIMPLE IRA distributions (you)');
    l.set('md502r.7b', L7b, 'Traditional, SEP, or SIMPLE IRA distributions (spouse)');
    l.set('md502r.8', L8, 'Total taxable pensions, IRAs, and annuities (Form 502, line 1d)');
    l.set('md502r.9a', youSsNet, 'Net Social Security benefits (you)');
    l.set('md502r.9b', spouseSsNet, 'Net Social Security benefits (spouse)');
    l.set('md502r.10a', youSsNet, 'Total Social Security and Railroad Retirement benefits (you)');
    l.set('md502r.10b', spouseSsNet, 'Total Social Security and Railroad Retirement benefits (spouse)');
    l.set('md502r.11a', youExcluded, 'Standard pension exclusion (you, Worksheet 13A)');
    l.set('md502r.11b', spouseExcluded, 'Standard pension exclusion (spouse, Worksheet 13A)');
  }

  return { line1d: L8, line10a, youExcluded, spouseExcluded, youSsNet, spouseSsNet, needs502R };
}

/** Form 502CR Part M — Senior Tax Credit (for residents 65+ whose FAGI is within the statutory limit). */
function computeSeniorTaxCredit(f: TaxFacts, fagi: Cents, p: MdParams, l: Ledger): Cents {
  const status = f.filingStatus;
  const you65 = is65(f.taxpayer.dateOfBirth);
  const spouse65 = status === 'mfj' && Boolean(f.spouse && is65(f.spouse.dateOfBirth));
  if (!you65 && !spouse65) return 0;

  const stc = p.seniorTaxCredit;
  let credit = 0;
  if (status === 'mfj') {
    if (fagi <= stc.jointOrMfsMaxFagi) credit = you65 && spouse65 ? stc.jointBoth65Amount : stc.singleAmount;
  } else if (status === 'mfs') {
    if (you65 && fagi <= stc.jointOrMfsMaxFagi) credit = stc.mfsAmount;
  } else if (status === 'qss') {
    if (you65 && fagi <= stc.jointOrMfsMaxFagi) credit = stc.singleAmount;
  } else {
    if (you65 && fagi <= stc.unmarriedMaxFagi) credit = stc.singleAmount;
  }

  if (credit > 0) {
    l.set('md502cr.M1', credit, 'Senior tax credit (Form 502CR, Part M, line 1)');
    l.set('md502cr.AA12', credit, 'Senior tax credit (Form 502CR, Part AA, line 12)');
    l.set('md502cr.AA14', credit, 'Total nonrefundable credits (Form 502CR, Part AA, line 14)');
  }
  return credit;
}

const ownerIncome = (f: TaxFacts, who: Owner, totalTaxableSs: Cents, youSsNet: Cents, spouseSsNet: Cents, fed: FederalResult) => {
  const fl = fed.ledger;
  const totalNetSs = youSsNet + spouseSsNet;
  const ownerNetSs = who === 'taxpayer' ? youSsNet : spouseSsNet;
  const ownerTaxableSs = totalNetSs > 0 ? roundToDollar((totalTaxableSs * ownerNetSs) / totalNetSs) : 0;
  const ownerCapGainFromB = sumCents(
    (f.f1099B ?? []).filter((b) => b.owner === who).flatMap((b) => b.lots.map((lot) => normalizeLot(lot).row.gainOrLoss)),
  );
  const ownerMarketDiscount = sumCents(
    (f.f1099B ?? []).filter((b) => b.owner === who).flatMap((b) => b.lots.map((lot) => roundToDollar(lot.marketDiscount))),
  );
  const schEByOwner = ownerScheduleEIncome(f, fed.scheduleE);
  return sumCents([
    ...f.w2s.filter((w) => w.owner === who).map((w) => w.box1Wages),
    ...f.f1099Int.filter((x) => x.owner === who).map((x) => x.box1Interest + x.box3UsTreasuryInterest),
    ...f.f1099Div.filter((x) => x.owner === who).map((x) => x.box1aOrdinaryDividends + x.box2aCapitalGainDistributions),
    ...(f.f1099R ?? []).filter((r) => r.owner === who).map(fedTaxable1099R),
    ownerScheduleCIncome(f, who, fl),
    schEByOwner[who],
    ownerCapGainFromB,
    ownerMarketDiscount,
    ownerTaxableSs,
  ]);
};

const ownerSubtractions = (f: TaxFacts, who: Owner, pensionExcluded: Cents, totalTaxableSs: Cents, youSsNet: Cents, spouseSsNet: Cents) => {
  const totalNetSs = youSsNet + spouseSsNet;
  const ownerNetSs = who === 'taxpayer' ? youSsNet : spouseSsNet;
  const ownerTaxableSs = totalNetSs > 0 ? roundToDollar((totalTaxableSs * ownerNetSs) / totalNetSs) : 0;
  return sumCents([...f.f1099Int.filter((x) => x.owner === who).map((x) => x.box3UsTreasuryInterest), pensionExcluded, ownerTaxableSs]);
};

/** Maryland Form 502 (2025), full-year resident. Pure: facts + federal result in, lines out. */
export function computeMd(f: TaxFacts, fed: FederalResult, p: MdParams = MD_2025): MdResult {
  const l = new Ledger();
  const fl = fed.ledger;
  const status = f.filingStatus;
  const county: MdCounty = f.residency.mdCounty ?? 'Montgomery';

  // Income
  const L1 = l.set('md502.1', fl.get('f1040.11a'), 'Federal adjusted gross income');
  const wages = fl.get('f1040.1z');
  const netSeEarned = Math.max(0, fl.get('sch1.3') - fl.get('sch1.15') - fl.get('sch1.16') - fl.get('sch1.17'));
  l.set('md502.1a', wages, 'Wages');
  l.set('md502.1b', wages + netSeEarned, 'Earned income');
  const L1c = l.set('md502.1c', fl.get('f1040.7a'), 'Capital gain');
  const ret = compute502RAndPensionExclusion(f, p, l);
  l.set('md502.1d', ret.line1d, 'Taxable pensions, IRAs, and annuities');

  // Additions & Form 500DM Decoupling Modification
  const L2 = l.set(
    'md502.2',
    Math.max(0, fl.get('f1040.2a') - (f.stateReturn.homeStateMuniInterest ?? 0)),
    'Tax-exempt interest from other states’ bonds',
  );
  let dmCol1 = roundToDollar(f.mdDecoupling?.federalDepreciation ?? 0);
  let dmCol2 = roundToDollar(f.mdDecoupling?.mdDepreciationWithoutDecoupling ?? 0);
  if (!f.mdDecoupling) {
    for (const r of f.rentals ?? []) {
      for (const a of r.depreciableAssets ?? []) {
        if (a.mdDepreciationWithoutDecoupling !== undefined) {
          dmCol1 += roundToDollar(a.currentYearDepreciation ?? 0);
          dmCol2 += roundToDollar(a.mdDepreciationWithoutDecoupling);
        }
      }
    }
  }
  const dmDiff1 = dmCol1 - dmCol2;
  const pteDm =
    roundToDollar(f.mdDecoupling?.pteDecouplingModification ?? 0) +
    sumCents((f.k1s ?? []).map((k) => roundToDollar(k.mdDecouplingModification ?? 0)));
  const needsForm500DM = dmCol1 !== 0 || dmCol2 !== 0 || pteDm !== 0;

  let dmAddition5 = 0;
  let dmSubtractionBb = 0;
  if (needsForm500DM) {
    l.set('md500dm.1.c1', dmCol1, 'Form 500DM line 1 col 1: Federal depreciation');
    l.set('md500dm.1.c2', dmCol2, 'Form 500DM line 1 col 2: Depreciation without decoupled provisions');
    l.set('md500dm.1.c3', dmDiff1, 'Form 500DM line 1 col 3: Depreciation decoupling difference');
    fl.set('md500dm.1.c1', dmCol1, 'Form 500DM line 1 col 1: Federal depreciation');
    fl.set('md500dm.1.c2', dmCol2, 'Form 500DM line 1 col 2: Depreciation without decoupled provisions');
    fl.set('md500dm.1.c3', dmDiff1, 'Form 500DM line 1 col 3: Depreciation decoupling difference');
    if (pteDm !== 0) {
      l.set('md500dm.9.c3', pteDm, 'Form 500DM line 9 col 3: Decoupling from PTE');
      fl.set('md500dm.9.c3', pteDm, 'Form 500DM line 9 col 3: Decoupling from PTE');
    }
    const netDm = dmDiff1 + pteDm;
    if (netDm > 0) dmAddition5 = netDm;
    else if (netDm < 0) dmSubtractionBb = Math.abs(netDm);
  }
  const L5 = l.set('md502.5', dmAddition5, 'Other additions (Form 500DM decoupling modification, code l)');
  if (dmAddition5 > 0) fl.set('md502.5', dmAddition5, 'Other additions (Form 500DM decoupling modification, code l)');
  const L6 = l.set('md502.6', L2 + L5, 'Total additions');
  const L7 = l.set('md502.7', L1 + L6, 'Federal AGI + additions');
  fl.set('md502.7', L7, 'Federal AGI + additions');

  // Subtractions (10a = Pension exclusion Worksheet 13A; 11 = Social Security; 13 = 502SU; 14 = Two-income Worksheet 13D)
  const L10a = l.set('md502.10a', ret.line10a, 'Pension exclusion', 'Worksheet 13A');
  const L11 = l.set('md502.11', fl.get('f1040.6b'), 'Taxable Social Security benefits');
  const usObligations = sumCents(f.f1099Int.map((x) => x.box3UsTreasuryInterest));
  const SUab = l.set('md502su.ab', usObligations, 'Income from U.S. Government obligations');
  const SUbb = l.set('md502su.bb', dmSubtractionBb, 'Net decoupling subtraction modification (Form 500DM, code bb)');
  if (dmSubtractionBb > 0) fl.set('md502su.bb', dmSubtractionBb, 'Net decoupling subtraction modification (Form 500DM, code bb)');
  const persons = status === 'mfj' ? 2 : 1;
  const SUhh = l.set(
    'md502su.hh',
    usObligations > 0 ? persons * (mdExemptionValue(L1 - usObligations, status, p) - mdExemptionValue(L1, status, p)) : 0,
    'Exemption adjustment for U.S. obligations',
    'Worksheet 13C',
  );
  const L13 = l.set(
    'md502.13',
    l.set('md502su.total', SUab + SUbb + SUhh, 'Total subtractions from Form 502SU'),
    'Subtractions from Form 502SU',
  );
  fl.set('md502.13', L13, 'Subtractions from Form 502SU');
  let L14 = 0;
  if (status === 'mfj' && f.spouse) {
    const you =
      ownerIncome(f, 'taxpayer', L11, ret.youSsNet, ret.spouseSsNet, fed) -
      ownerSubtractions(f, 'taxpayer', ret.youExcluded, L11, ret.youSsNet, ret.spouseSsNet);
    const spouse =
      ownerIncome(f, 'spouse', L11, ret.youSsNet, ret.spouseSsNet, fed) -
      ownerSubtractions(f, 'spouse', ret.spouseExcluded, L11, ret.youSsNet, ret.spouseSsNet);
    L14 = Math.min(usd(1_200), Math.max(0, Math.min(you, spouse)));
  }
  l.set('md502.14', L14, 'Two-income subtraction', 'Worksheet 13D');
  const L15 = l.set('md502.15', L10a + L11 + L13 + L14, 'Total subtractions');
  const L16 = l.set('md502.16', L7 - L15, 'Maryland adjusted gross income');

  // Deduction: itemizing in MD is allowed only if you itemized federally.
  const standard = p.standardDeduction[status];
  const a = fl.get('schA.17');
  // Comptroller guidance (2025): property taxes fill the SALT limit first; only the rest is income tax to add back.
  const b = Math.max(0, Math.min(fl.get('schA.5a'), fl.get('schA.5e') - fl.get('schA.5b') - fl.get('schA.5c')));
  const c = mdItemizedPhaseOut(L1, status, p);
  const itemizing = fed.itemizing && a - b - c > standard;
  if (itemizing) {
    l.set('md502.17a', a, 'Federal itemized deductions');
    l.set('md502.17b', b, 'State and local income taxes deducted federally');
    l.set('md502.17c', c, 'Itemized deduction phase-out', 'Worksheet 14A');
  }
  const L17 = l.set('md502.17', itemizing ? a - b - c : standard, itemizing ? 'Itemized deductions' : 'Standard deduction');
  const L18 = l.set('md502.18', L16 - L17, 'Net income');

  // Exemptions
  const you = true;
  const spouse = status === 'mfj';
  const age65 = (is65(f.taxpayer.dateOfBirth) ? 1 : 0) + (spouse && f.spouse && is65(f.spouse.dateOfBirth) ? 1 : 0);
  const blind = (f.taxpayer.blind ? 1 : 0) + (spouse && f.spouse?.blind ? 1 : 0);
  const extra = age65 + blind;
  const each = mdExemptionValue(L1, status, p);
  const A = l.set('md502.A', (spouse ? 2 : 1) * each, 'Personal exemptions');
  const B = l.set('md502.B', extra * p.exemption.ageOrBlind, '65 or over / blind');
  const L19 = l.set('md502.19', l.set('md502.D', A + B, 'Total exemptions'), 'Exemption amount');
  const L20 = l.set('md502.20', Math.max(0, L18 - L19), 'Taxable net income');

  // Tax & Credits
  const subjectToSurtax = L1 > p.capitalGainSurtax.fagiThreshold ? Math.max(0, L1c) : 0;
  const L20a = l.set('md502.20a', subjectToSurtax, 'Net capital gain subject to the 2% tax (Form 502CG)');
  if (subjectToSurtax > 0) {
    l.set('md502cg.1', L1c, 'Net capital gain in Maryland AGI');
    l.set('md502cg.9', subjectToSurtax, 'Net capital gain subject to additional tax');
  }
  const L21 = l.set('md502.21', mdStateTax(L20, status, p), 'Maryland tax');
  const L21b = l.set('md502.21b', mdCapitalGainSurtax(L1, L20a, p), 'Additional 2% tax on net capital gain');
  const L24 = l.set('md502.24', computeSeniorTaxCredit(f, L1, p, l), 'Other income tax credits for individuals (Form 502CR)');
  const L26 = l.set('md502.26', L24, 'Total credits');
  const L27 = l.set('md502.27', Math.max(0, L21 + L21b - L26), 'Maryland tax after credits');
  const L28 = l.set('md502.28', mdLocalTax(L20, county, status, p), `Local tax (${county})`);
  const L33 = l.set('md502.33', L28, 'Local tax after credits');
  const L34 = l.set('md502.34', L27 + L33, 'Total Maryland and local tax');
  const L40 = l.set('md502.40', L34, 'Total tax and contributions');

  // Payments
  const mdW2 = f.w2s.filter((w) => w.stateLines.some((s) => s.state === 'MD'));
  const md1099R = (f.f1099R ?? []).filter((r) => r.stateLines.some((s) => s.state === 'MD'));
  const md1099Nec = (f.f1099Nec ?? []).filter((n) => n.stateLines.some((s) => s.state === 'MD'));
  const L41 = l.set(
    'md502.41',
    sumCents([
      ...mdW2.flatMap((w) => [
        ...w.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax),
        ...w.localLines.map((x) => x.localTax),
      ]),
      ...md1099R.flatMap((r) => r.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax)),
      ...md1099Nec.flatMap((n) => n.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax)),
    ]),
    'Maryland and local tax withheld',
  );
  const sr = f.stateReturn;
  const L43 = l.set(
    'md502.43',
    sumCents(sr.estimatedPayments) + sr.priorYearApplied + sr.extensionPayment,
    'Estimated payments, 2024 overpayment applied, extension payment',
  );
  const L46 = l.set('md502.46', L41 + L43, 'Total payments and credits');
  const L47 = l.set('md502.47', Math.max(0, L40 - L46), 'Balance due');
  const L48 = l.set('md502.48', Math.max(0, L46 - L40), 'Overpayment');
  l.set('md502.50', L48, 'Refund');
  l.set('md502.52', L47, 'Total amount due');

  const rule = p.local[county];
  const localRatePrinted = rule.kind === 'flat' ? String(Math.round(rule.rate / 100)).padStart(3, '0') : null;
  const forms: MdFormId[] = ['md502'];
  if (ret.needs502R) forms.push('md502r');
  if (L13 > 0) forms.push('md502su');
  if (L24 > 0) forms.push('md502cr');
  if (subjectToSurtax > 0) forms.push('md502cg');
  if (needsForm500DM) forms.push('md500dm');
  return {
    ledger: l,
    itemizing,
    totalTax: L40,
    totalPayments: L46,
    refund: L48,
    amountOwed: L47,
    localRatePrinted,
    exemptions: { you, spouse, age65, blind, extra, total: (spouse ? 2 : 1) + extra },
    pensionExclusion: { you: ret.youExcluded > 0, spouse: ret.spouseExcluded > 0 },
    forms,
    needsForm500DM,
    needsForm502SU: L13 > 0,
  };
}

export const computeMaryland = computeMd;
