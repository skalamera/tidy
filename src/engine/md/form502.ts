import { sumCents, usd, type Cents } from '../money';
import { Ledger } from '../ledger';
import { MD_2025, type MdCounty, type MdParams } from '../params/md2025';
import type { FederalResult } from '../federal/form1040';
import type { Owner, TaxFacts } from '../../shared/facts';
import { mdCapitalGainSurtax, mdExemptionValue, mdItemizedPhaseOut, mdLocalTax, mdStateTax } from './mdTax';

export type MdFormId = 'md502' | 'md502su' | 'md502cg';

export interface MdResult {
  ledger: Ledger;
  itemizing: boolean;
  totalTax: Cents;
  totalPayments: Cents;
  refund: Cents;
  amountOwed: Cents;
  /** Flat local rate as printed after ".0" on line 28 (e.g. "320" for 3.20%), or null for bracket counties. */
  localRatePrinted: string | null;
  exemptions: { you: boolean; spouse: boolean; age65: number; total: number };
  forms: MdFormId[];
}

/** Born before January 2, 1961 = 65 or older at the end of 2025 (same test as Form 1040 line 12d). */
export const is65 = (dob: string | null) => dob !== null && dob < '1961-01-02';

const ownerIncome = (f: TaxFacts, who: Owner) =>
  sumCents([
    ...f.w2s.filter((w) => w.owner === who).map((w) => w.box1Wages),
    ...f.f1099Int.filter((x) => x.owner === who).map((x) => x.box1Interest + x.box3UsTreasuryInterest),
    ...f.f1099Div.filter((x) => x.owner === who).map((x) => x.box1aOrdinaryDividends + x.box2aCapitalGainDistributions),
  ]);

const ownerSubtractions = (f: TaxFacts, who: Owner) =>
  sumCents(f.f1099Int.filter((x) => x.owner === who).map((x) => x.box3UsTreasuryInterest));

/** Maryland Form 502 (2025), full-year resident, Phase-1 scope. Pure: facts + federal result in, lines out. */
export function computeMd(f: TaxFacts, fed: FederalResult, p: MdParams = MD_2025): MdResult {
  const l = new Ledger();
  const fl = fed.ledger;
  const status = f.filingStatus;
  const county: MdCounty = f.residency.mdCounty ?? 'Montgomery';

  // Income
  const L1 = l.set('md502.1', fl.get('f1040.11a'), 'Federal adjusted gross income');
  l.set('md502.1a', fl.get('f1040.1z'), 'Wages');
  l.set('md502.1b', fl.get('f1040.1z'), 'Earned income');
  const L1c = l.set('md502.1c', fl.get('f1040.7a'), 'Capital gain');

  // Additions
  const L2 = l.set(
    'md502.2',
    Math.max(0, fl.get('f1040.2a') - (f.stateReturn.homeStateMuniInterest ?? 0)),
    'Tax-exempt interest from other states’ bonds',
  );
  const L6 = l.set('md502.6', L2, 'Total additions');
  const L7 = l.set('md502.7', L1 + L6, 'Federal AGI + additions');

  // Subtractions (502SU line ab = U.S. obligations; line hh = exemption adjustment, Worksheet 13C)
  const usObligations = sumCents(f.f1099Int.map((x) => x.box3UsTreasuryInterest));
  const SUab = l.set('md502su.ab', usObligations, 'Income from U.S. Government obligations');
  const persons = status === 'mfj' ? 2 : 1;
  const SUhh = l.set(
    'md502su.hh',
    usObligations > 0 ? persons * (mdExemptionValue(L1 - usObligations, status, p) - mdExemptionValue(L1, status, p)) : 0,
    'Exemption adjustment for U.S. obligations',
    'Worksheet 13C',
  );
  const L13 = l.set('md502.13', l.set('md502su.total', SUab + SUhh, 'Total subtractions from Form 502SU'), 'Subtractions from Form 502SU');
  let L14 = 0;
  if (status === 'mfj' && f.spouse) {
    const you = ownerIncome(f, 'taxpayer') - ownerSubtractions(f, 'taxpayer');
    const spouse = ownerIncome(f, 'spouse') - ownerSubtractions(f, 'spouse');
    L14 = Math.min(usd(1_200), Math.max(0, Math.min(you, spouse)));
  }
  l.set('md502.14', L14, 'Two-income subtraction', 'Worksheet 13D');
  const L15 = l.set('md502.15', L13 + L14, 'Total subtractions');
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
  const each = mdExemptionValue(L1, status, p);
  const A = l.set('md502.A', (spouse ? 2 : 1) * each, 'Personal exemptions');
  const B = l.set('md502.B', age65 * p.exemption.ageOrBlind, '65 or over / blind');
  const L19 = l.set('md502.19', l.set('md502.D', A + B, 'Total exemptions'), 'Exemption amount');
  const L20 = l.set('md502.20', Math.max(0, L18 - L19), 'Taxable net income');

  // Tax
  const subjectToSurtax = L1 > p.capitalGainSurtax.fagiThreshold ? Math.max(0, L1c) : 0;
  const L20a = l.set('md502.20a', subjectToSurtax, 'Net capital gain subject to the 2% tax (Form 502CG)');
  if (subjectToSurtax > 0) {
    l.set('md502cg.1', L1c, 'Net capital gain in Maryland AGI');
    l.set('md502cg.9', subjectToSurtax, 'Net capital gain subject to additional tax');
  }
  const L21 = l.set('md502.21', mdStateTax(L20, status, p), 'Maryland tax');
  const L21b = l.set('md502.21b', mdCapitalGainSurtax(L1, L20a, p), 'Additional 2% tax on net capital gain');
  const L27 = l.set('md502.27', L21 + L21b, 'Maryland tax after credits');
  const L28 = l.set('md502.28', mdLocalTax(L20, county, status, p), `Local tax (${county})`);
  const L33 = l.set('md502.33', L28, 'Local tax after credits');
  const L34 = l.set('md502.34', L27 + L33, 'Total Maryland and local tax');
  const L40 = l.set('md502.40', L34, 'Total tax and contributions');

  // Payments
  const mdW2 = f.w2s.filter((w) => w.stateLines.some((s) => s.state === 'MD'));
  const L41 = l.set(
    'md502.41',
    sumCents(
      mdW2.flatMap((w) => [...w.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax), ...w.localLines.map((x) => x.localTax)]),
    ),
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
  if (L13 > 0) forms.push('md502su');
  if (subjectToSurtax > 0) forms.push('md502cg');
  return {
    ledger: l,
    itemizing,
    totalTax: L40,
    totalPayments: L46,
    refund: L48,
    amountOwed: L47,
    localRatePrinted,
    exemptions: { you, spouse, age65, total: (spouse ? 2 : 1) + age65 },
    forms,
  };
}
