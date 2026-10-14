import { formatUsd, sumCents } from '../engine/money';
import type { FederalResult } from '../engine/federal/form1040';
import type { TaxFacts } from '../shared/facts';
import type { AppState, Flag } from '../shared/state';
import { PRIOR_TAX_YEAR } from './deriveFacts';

const LABEL: Record<string, string> = {
  f1099_misc: '1099-MISC income',
  prior_year_state_return: 'a state return on its own',
  brokerage_statement: 'brokerage statements',
  other: 'this kind of document',
};
const PART_LABEL: Record<string, string> = {
  f1099_misc: 'a 1099-MISC',
  f1099_oid: 'a 1099-OID',
  other: 'a form Tidy doesn’t read yet',
};

/** Problems the user must know about. Blockers stop the final package until they are resolved. Pure. */
export function deriveFlags(state: AppState, f: TaxFacts, r: FederalResult): Flag[] {
  const flags: Flag[] = [];
  const answer = (id: string) => state.questions.find((q) => q.id === id)?.answer ?? null;
  for (const d of state.documents) {
    if (d.status === 'unsupported') {
      flags.push({
        id: `unsupported:${d.id}`,
        sectionId: 'documents',
        severity: 'blocker',
        title: `Tidy can’t prepare ${LABEL[d.docType ?? 'other'] ?? 'this'} yet`,
        detail: `“${d.fileName}” needs a feature that isn’t built yet. Remove it if it was uploaded by mistake.`,
      });
    }
    if (d.status === 'failed') {
      flags.push({
        id: `failed:${d.id}`,
        sectionId: 'documents',
        severity: 'warning',
        title: `We couldn’t read “${d.fileName}”`,
        detail: d.error ?? 'Try uploading it again.',
      });
    }
    if (d.status === 'done' && !d.supersededBy) {
      const prior = d.extractions.find((e) => e.form === 'prior_year');
      if (prior && prior.form === 'prior_year' && prior.data.taxYear !== PRIOR_TAX_YEAR) {
        flags.push({
          id: `wrong-year:${d.id}`,
          sectionId: 'documents',
          severity: 'warning',
          title: `“${d.fileName}” is your ${prior.data.taxYear} return`,
          detail: 'Tidy fills in 2025 from your 2024 return, so it doesn’t use this one. Upload your 2024 return, then remove this file.',
        });
      }
      for (const part of d.classification?.parts ?? []) {
        const label = PART_LABEL[part.form];
        if (!label) continue;
        flags.push({
          id: `part:${d.id}:${part.form}:${part.firstPage}`,
          sectionId: 'investments',
          severity: 'blocker',
          title: `“${d.fileName}” includes ${label}`,
          detail: `Pages ${part.firstPage}–${part.lastPage}. Tidy can’t prepare that part yet, so your return would be incomplete.`,
        });
      }
    }
  }
  if (answer('resident-state') === 'other') {
    flags.push({
      id: 'state-other',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Only Maryland returns for now',
      detail: 'Tidy can’t prepare your state return yet.',
    });
  }
  if (answer('other-income') === 'yes') {
    flags.push({
      id: 'other-income',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Some of your income needs forms Tidy can’t prepare yet',
      detail: 'Farm income (Schedule F) and specialized income types aren’t supported yet. Until then this return would leave them out.',
    });
  }
  if (f.hasNondeductibleIraBasis === true) {
    flags.push({
      id: 'ira-basis-8606',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Nondeductible IRA basis needs Form 8606',
      detail:
        'Because you have after-tax basis in a traditional IRA, part of your IRA distribution is tax-free and must be figured on Form 8606, which Tidy doesn’t prepare yet.',
    });
  }
  for (const dist of f.f1099R ?? []) {
    const codes = dist.box7Codes.toUpperCase();
    const isDirectRolloverOrRoth = /^[GHQ]/.test(codes);
    if (dist.box2bTaxableNotDetermined && dist.box2aTaxableAmount === 0 && !isDirectRolloverOrRoth && (dist.rolloverAmount ?? 0) === 0) {
      flags.push({
        id: `1099r-undetermined:${dist.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `Taxable amount not determined on ${dist.payerName} 1099-R`,
        detail:
          'Box 2b “Taxable amount not determined” is checked and box 2a is blank or zero. Figuring the taxable portion requires the Simplified Method or General Rule worksheet.',
      });
    }
    if (/[125689AEJKLMPSTUV]/.test(codes)) {
      flags.push({
        id: `1099r-code:${dist.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `1099-R distribution code “${codes}” from ${dist.payerName} needs extra forms`,
        detail:
          'Early distributions (code 1), excess contributions, Roth conversions, or specialized distribution codes require Form 5329 or Form 8606, which Tidy doesn’t prepare yet.',
      });
    }
  }
  if ((f.ssa1099 ?? []).reduce((s, x) => s + x.box5NetBenefits, 0) < 0) {
    flags.push({
      id: 'ssa-negative-benefits',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Social Security repayments exceeded benefits paid',
      detail: 'Your net Social Security benefits in box 5 are negative, which requires a special repayment calculation in Publication 915.',
    });
  }
  if (answer('has-dependents') === 'yes') {
    flags.push({
      id: 'dependents',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Returns with dependents aren’t supported yet',
      detail: 'Dependents change credits and exemptions on every form. Tidy can’t handle them yet.',
    });
  }
  if (f.residency.fullYear === false) {
    flags.push({
      id: 'part-year',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Part-year residency isn’t supported yet',
      detail: 'Part-year Maryland residents need extra Form 502 steps that Tidy can’t do yet.',
    });
  }
  if (f.digitalAssets === true) {
    flags.push({
      id: 'digital-assets',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Digital asset sales aren’t supported yet',
      detail: 'Crypto and digital asset reporting (Form 1099-DA and crypto tax lots) is not supported yet.',
    });
  }
  if (r.mayOweAmt) {
    flags.push({
      id: 'amt',
      sectionId: 'federal_summary',
      severity: 'blocker',
      title: 'You may owe alternative minimum tax',
      detail: 'Our AMT check can’t rule it out, and Form 6251 isn’t supported yet. A CPA should finish this return.',
    });
  }
  const foreignTax = sumCents([...f.f1099Int.map((x) => x.box6ForeignTaxPaid), ...f.f1099Div.map((x) => x.box7ForeignTaxPaid)]);
  if (foreignTax > 0) {
    flags.push({
      id: 'foreign-tax',
      sectionId: 'investments',
      severity: 'warning',
      title: `You paid ${formatUsd(foreignTax)} in foreign tax`,
      detail: 'The foreign tax credit isn’t claimed yet, so this return may overstate your tax by up to that amount.',
    });
  }
  if ((f.carryovers?.amtCredit ?? 0) > 0) {
    flags.push({
      id: 'carryover-amt-credit',
      sectionId: 'federal_summary',
      severity: 'blocker',
      title: `Prior-year AMT credit carryover (${formatUsd(f.carryovers!.amtCredit!)}) needs Form 8801`,
      detail: 'Your 2024 return carried forward a minimum tax credit on Form 8801, which Tidy doesn’t prepare yet.',
    });
  }
  if ((f.carryovers?.foreignTaxCredit ?? 0) > 0) {
    flags.push({
      id: 'carryover-ftc',
      sectionId: 'investments',
      severity: 'warning',
      title: `You have a ${formatUsd(f.carryovers!.foreignTaxCredit!)} foreign tax credit carryover`,
      detail: 'Form 1116 carryovers aren’t claimed yet, so this return may overstate your tax by up to that amount.',
    });
  }
  if ((f.carryovers?.investmentInterest ?? 0) > 0) {
    flags.push({
      id: 'carryover-investment-interest',
      sectionId: 'deductions',
      severity: 'blocker',
      title: `Prior-year investment interest carryover (${formatUsd(f.carryovers!.investmentInterest!)}) needs Form 4952`,
      detail: 'Your 2024 return carried forward disallowed investment interest expense on Form 4952, which Tidy doesn’t prepare yet.',
    });
  }
  return flags;
}
