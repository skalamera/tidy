import { rateToDollar, roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { Form1099R, Person, TaxFacts } from '../../shared/facts';

/** Born before January 2, 1961 = 65 or older at the end of 2025 (Form 1040 line 12d / Schedule 1-A Part V). */
export const is65OrOlder = (dob: string | null | undefined): boolean => Boolean(dob && dob < '1961-01-02');

/** Valid 9-digit SSN required for the Schedule 1-A Enhanced Deduction for Seniors (ITINs starting with 9 do not qualify). */
const hasValidSsn = (p: Person | null | undefined): boolean => Boolean(p && /^\d{9}$/.test(p.ssn) && !p.ssn.startsWith('9'));

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
  const rawTaxable = roundToDollar(r.box2aTaxableAmount);
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

  for (const r of dists) {
    const d = taxableDistribution(r, p);
    if (r.iraSepSimple) {
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
export function schedule1A(f: TaxFacts, agi: Cents, p: FedParams, l: Ledger): Cents {
  if (f.filingStatus === 'mfs') return 0; // MFS is ineligible for the enhanced deduction for seniors.
  const youQualifies = is65OrOlder(f.taxpayer.dateOfBirth) && hasValidSsn(f.taxpayer);
  const spouseQualifies = f.filingStatus === 'mfj' && Boolean(f.spouse && is65OrOlder(f.spouse.dateOfBirth) && hasValidSsn(f.spouse));
  if (!youQualifies && !spouseQualifies) return 0;

  const sd = p.seniorDeduction;
  const L1 = l.set('sch1A.1', agi, 'Adjusted gross income (Form 1040, line 11b)');
  const L2e = l.set('sch1A.2e', 0, 'Foreign/territorial exclusions');
  const L3 = l.set('sch1A.3', L1 + L2e, 'Modified adjusted gross income (MAGI)');

  const L31 = l.set('sch1A.31', L3, 'MAGI (from Schedule 1-A, line 3)');
  const L32 = l.set('sch1A.32', sd.phaseOutStart[f.filingStatus], 'Phase-out threshold ($150,000 MFJ / $75,000 others)');
  const L33 = l.set('sch1A.33', Math.max(0, L31 - L32), 'MAGI over threshold');
  const L34 = l.set('sch1A.34', L33 > 0 ? rateToDollar(L33, sd.phaseOutRate) : 0, '6% of excess MAGI');
  const perPerson = Math.max(0, sd.amountPerPerson - L34);
  if (L33 > 0) l.set('sch1A.35', perPerson, '$6,000 minus line 34');

  const L36a = l.set('sch1A.36a', youQualifies ? perPerson : 0, 'Enhanced senior deduction (you)');
  const L36b = l.set('sch1A.36b', spouseQualifies ? perPerson : 0, 'Enhanced senior deduction (spouse)');
  const L37 = l.set('sch1A.37', L36a + L36b, 'Total enhanced deduction for seniors');
  return l.set('sch1A.38', L37, 'Total additional deductions (Schedule 1-A, line 38)');
}
