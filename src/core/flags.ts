import { formatUsd, sumCents } from '../engine/money';
import type { FederalResult } from '../engine/federal/form1040';
import type { TaxFacts } from '../shared/facts';
import type { AppState, Flag } from '../shared/state';

const LABEL: Record<string, string> = {
  f1099_b: 'investment sales (1099-B)',
  k1_1065: 'partnership K-1s',
  k1_1120s: 'S corporation K-1s',
  k1_1041: 'trust K-1s',
  f1099_r: 'retirement distributions (1099-R)',
  f1099_misc: '1099-MISC income',
  f1099_nec: '1099-NEC income',
  ssa_1099: 'Social Security benefits',
  prior_year_state_return: 'a state return on its own',
  brokerage_statement: 'brokerage statements',
  other: 'this kind of document',
};
const PART_LABEL: Record<string, string> = {
  f1099_b: 'a 1099-B (investment sales)',
  f1099_misc: 'a 1099-MISC',
  f1099_oid: 'a 1099-OID',
  k1: 'a Schedule K-1',
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
      detail:
        'Business, rental, pass-through, retirement and Social Security income, and investment sales, are on the roadmap. Until then this return would leave them out.',
    });
  }
  if (answer('senior-or-blind') === 'yes') {
    flags.push({
      id: 'senior-or-blind',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Returns for people 65 or older, or blind, aren’t supported yet',
      detail:
        'They need the larger standard deduction, the senior deduction on Schedule 1-A and Maryland’s extra exemptions. That support is planned next.',
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
      detail: 'Crypto sales go on Form 8949, which arrives with investment sales support.',
    });
  }
  if (f.f1099Div.some((x) => x.box2bUnrecaptured1250Gain > 0 || x.box2d28RateGain > 0)) {
    flags.push({
      id: 'schedule-d',
      sectionId: 'investments',
      severity: 'blocker',
      title: 'Some capital gains need Schedule D',
      detail: 'A 1099-DIV shows box 2b or 2d amounts, which need Schedule D. That comes with investment sales support.',
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
  const qbiDividends = sumCents(f.f1099Div.map((x) => x.box5Section199aDividends));
  if (qbiDividends > 0) {
    flags.push({
      id: 'qbi-dividends',
      sectionId: 'investments',
      severity: 'warning',
      title: `Your 1099-DIV shows ${formatUsd(qbiDividends)} of Section 199A dividends`,
      detail: 'They usually qualify for a 20% deduction (Form 8995) that Tidy doesn’t take yet, so this return may overstate your tax.',
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
  return flags;
}
