import { formatUsd, sumCents } from '../engine/money';
import type { MdCounty } from '../engine/params/md2025';
import type { PriorYearExtractionT } from '../shared/schemas/extraction';
import type { FilingStatus, TaxFacts } from '../shared/facts';
import type { AppState, Question, SectionId } from '../shared/state';
import { amountCents } from './amount';
import MD_SUBDIVISIONS from '../shared/data/md-subdivisions-2025.json';

export interface RuleContext {
  state: AppState;
  facts: TaxFacts;
  prior: PriorYearExtractionT | null;
}

export type QuestionDraft = Pick<Question, 'kind' | 'prompt' | 'help' | 'choices' | 'suggested' | 'blocking'>;

/** A deterministic question: when it applies, what to ask, and how the answer changes the facts. */
export interface Rule {
  id: string;
  sectionId: SectionId;
  applies(ctx: RuleContext): boolean;
  build(ctx: RuleContext): QuestionDraft;
  /** Write the answer into the facts being derived. Must be idempotent. */
  apply(answer: string, facts: TaxFacts, prior: PriorYearExtractionT | null): void;
}

const yesNo = (prompt: string, help: string): QuestionDraft => ({
  kind: 'yes_no',
  prompt,
  help,
  choices: null,
  suggested: null,
  blocking: true,
});

export const STATUS_LABEL: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
  qss: 'Qualifying surviving spouse',
};

const money = (prompt: string, help: string): QuestionDraft => ({
  kind: 'money',
  prompt,
  help,
  choices: null,
  suggested: 0,
  blocking: true,
});
const cents = (answer: string) => Number.parseInt(answer, 10) || 0;

const answerOf = (c: RuleContext, id: string) => c.state.questions.find((q) => q.id === id)?.answer ?? null;
const stateName = (s: string | null) => (s === 'MD' ? 'Maryland' : 'your state');
const countyLabel = (county: string) => (county.startsWith('Baltimore') ? county : `${county} County`);
const exemptInterest = (f: TaxFacts) =>
  sumCents([...f.f1099Int.map((x) => x.box8TaxExemptInterest), ...f.f1099Div.map((x) => x.box12ExemptInterestDividends)]);
/** True when an uploaded payment record already covers estimated payments of this kind. */
const hasEstimateDocs = (c: RuleContext, kind: 'federal_estimate' | 'state_estimate') =>
  c.state.documents.some((d) => d.status === 'done' && d.extractions.some((x) => x.form === 'payment' && x.data.kind === kind));

export const RULES: Rule[] = [
  {
    id: 'filing-status-same',
    sectionId: 'profile',
    applies: (c) => c.prior !== null,
    build: (c) =>
      yesNo(
        `Last year you filed as “${STATUS_LABEL[c.prior!.filingStatus]}”. Is that still right for 2025?`,
        'Your filing status depends on whether you were married on December 31, 2025.',
      ),
    apply: () => {},
  },
  {
    id: 'filing-status',
    sectionId: 'profile',
    applies: (c) => c.prior === null || answerOf(c, 'filing-status-same') === 'no',
    build: () => ({
      kind: 'choice',
      prompt: 'How will you file for 2025?',
      help: 'Pick the status that applied on December 31, 2025.',
      choices: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      f.filingStatus = a as FilingStatus;
    },
  },
  {
    id: 'resident-state',
    sectionId: 'profile',
    applies: () => true,
    build: () => ({
      kind: 'choice',
      prompt: 'Where did you live on December 31, 2025?',
      help: 'Tidy prepares Maryland resident returns today. More states are coming.',
      choices: [
        { value: 'MD', label: 'Maryland' },
        { value: 'other', label: 'Somewhere else' },
      ],
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      f.residency.state = a === 'MD' ? a : null;
    },
  },
  {
    id: 'full-year-resident',
    sectionId: 'profile',
    applies: (c) => c.facts.residency.state !== null,
    build: (c) =>
      yesNo(
        `Did you live in ${stateName(c.facts.residency.state)} for all of 2025?`,
        'If you moved in or out during the year you need a part-year return, which Tidy doesn’t support yet.',
      ),
    apply: (a, f) => {
      f.residency.fullYear = a === 'yes';
    },
  },
  {
    id: 'digital-assets',
    sectionId: 'profile',
    applies: () => true,
    build: () =>
      yesNo(
        'In 2025, did you receive, sell, or trade any crypto or other digital assets?',
        'The IRS asks everyone this on page 1 of Form 1040. Only holding crypto you bought earlier counts as “No”.',
      ),
    apply: (a, f) => {
      f.digitalAssets = a === 'yes';
    },
  },
  {
    id: 'foreign-accounts',
    sectionId: 'investments',
    applies: (c) =>
      sumCents(c.facts.f1099Int.map((x) => x.box1Interest)) > 150_000 ||
      sumCents(c.facts.f1099Div.map((x) => x.box1aOrdinaryDividends)) > 150_000,
    build: () =>
      yesNo(
        'At any time in 2025, did you have a bank or investment account outside the U.S.?',
        'Schedule B asks this whenever interest or dividends are over $1,500. Accounts at U.S. firms that hold foreign stocks don’t count.',
      ),
    apply: (a, f) => {
      f.foreignAccounts.hasForeignAccount = a === 'yes';
    },
  },
  {
    id: 'foreign-trust',
    sectionId: 'investments',
    applies: (c) => answerOf(c, 'foreign-accounts') !== null,
    build: () =>
      yesNo(
        'In 2025, did you receive money from, create, or transfer money to a trust outside the U.S.?',
        'Also asked on Schedule B. Most people answer “No”.',
      ),
    apply: (a, f) => {
      f.foreignAccounts.foreignTrust = a === 'yes';
    },
  },
  {
    id: 'state-balance-paid',
    sectionId: 'deductions',
    applies: (c) => c.prior !== null && amountCents(c.prior.stateBalanceDue) > 0,
    build: (c) =>
      yesNo(
        `Your 2024 ${stateName(c.prior!.residentState)} return showed ${formatUsd(amountCents(c.prior!.stateBalanceDue))} owed. Did you pay it during 2025?`,
        'State income tax you paid in 2025, even for last year, counts toward your 2025 state and local tax deduction.',
      ),
    apply: (a, f, prior) => {
      if (a === 'yes' && prior) {
        f.itemized.stateIncomeTaxPayments.push({ label: '2024 state balance paid in 2025', amount: amountCents(prior.stateBalanceDue) });
      }
    },
  },
  {
    id: 'prior-year-applied',
    sectionId: 'payments',
    applies: (c) => c.prior !== null && amountCents(c.prior.appliedToNextYear) > 0,
    build: (c) =>
      yesNo(
        `Last year you applied ${formatUsd(amountCents(c.prior!.appliedToNextYear))} of your refund to your 2025 taxes. Is that right?`,
        'This is line 36 of your 2024 Form 1040. It counts as a 2025 payment.',
      ),
    apply: (a, f) => {
      if (a === 'no') f.payments.federalPriorYearApplied = 0;
    },
  },
  {
    id: 'extension-payment',
    sectionId: 'payments',
    applies: () => true,
    build: () => ({
      kind: 'money',
      prompt: 'How much did you pay with a 2025 extension request (Form 4868)? Enter 0 if none.',
      help: 'If you filed an extension in April 2026 and sent a payment with it, enter that amount.',
      choices: null,
      suggested: 0,
      blocking: true,
    }),
    apply: (a, f) => {
      f.payments.federalExtensionPayment = Number.parseInt(a, 10) || 0;
    },
  },
  {
    id: 'md-subdivision',
    sectionId: 'profile',
    applies: (c) => c.facts.residency.state === 'MD',
    build: () => ({
      kind: 'choice',
      prompt: 'Where did you live in Maryland on December 31, 2025?',
      help: 'Pick your city or town if you lived inside its limits; otherwise pick your county. This sets your local tax rate.',
      choices: MD_SUBDIVISIONS.map((d) => ({
        value: d.code,
        label: d.code.endsWith('00') ? `${countyLabel(d.county)} (not in a town)` : `${d.name} · ${countyLabel(d.county)}`,
      })),
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      const d = MD_SUBDIVISIONS.find((x) => x.code === a);
      if (!d) return;
      f.residency.mdSubdivision = { code: d.code, name: d.code.endsWith('00') ? d.county : d.name };
      f.residency.mdCounty = d.county as MdCounty; // every county in the file has a local tax rate (tested)
    },
  },
  {
    id: 'has-dependents',
    sectionId: 'profile',
    applies: () => true,
    build: (c) =>
      yesNo(
        c.prior && c.prior.dependents.length > 0
          ? `Last year you claimed ${c.prior.dependents.length === 1 ? 'a dependent' : `${c.prior.dependents.length} dependents`}. Can you claim anyone as a dependent for 2025?`
          : 'Can you claim anyone as a dependent for 2025, like a child or a relative you support?',
        'Dependents change credits and exemptions on every form.',
      ),
    apply: () => {},
  },
  {
    id: 'other-income',
    sectionId: 'profile',
    applies: () => true,
    build: () =>
      yesNo(
        'Besides wages, interest and dividends, did you have any other income in 2025?',
        'For example a business, rental property, partnership or S corporation, trust, IRA or pension, Social Security, or sales of stocks, funds or other property.',
      ),
    apply: () => {},
  },
  {
    id: 'senior-or-blind',
    sectionId: 'profile',
    applies: () => true,
    build: (c) =>
      yesNo(
        c.facts.filingStatus === 'mfj'
          ? 'Were you or your spouse born before January 2, 1961, or is either of you legally blind?'
          : 'Were you born before January 2, 1961, or are you legally blind?',
        'People 65 or older, or blind, get a larger standard deduction and the new senior deduction.',
      ),
    apply: () => {},
  },
  {
    id: 'home-state-munis',
    sectionId: 'investments',
    applies: (c) => c.facts.residency.state !== null && exemptInterest(c.facts) > 0,
    build: (c) => ({
      kind: 'money',
      prompt: `Of your ${formatUsd(exemptInterest(c.facts))} of tax-exempt interest, how much came from ${stateName(c.facts.residency.state)} bonds?`,
      help: `${stateName(c.facts.residency.state)} taxes interest from other states’ bonds. Your brokerage’s year-end statement lists tax-exempt interest by state.`,
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      f.stateReturn.homeStateMuniInterest = Math.min(cents(a), exemptInterest(f));
    },
  },
  {
    id: 'federal-estimates',
    sectionId: 'payments',
    applies: (c) => !hasEstimateDocs(c, 'federal_estimate'),
    build: () =>
      money(
        'How much federal estimated tax did you pay for 2025? Include the January 2026 payment. Enter 0 if none.',
        'Your IRS online account (irs.gov/account) lists every payment.',
      ),
    apply: (a, f) => {
      if (cents(a) > 0) f.payments.federalEstimated.push(cents(a));
    },
  },
  {
    id: 'state-estimates-2025',
    sectionId: 'payments',
    applies: (c) => c.facts.residency.state !== null && !hasEstimateDocs(c, 'state_estimate'),
    build: (c) =>
      money(
        `How much ${stateName(c.facts.residency.state)} estimated tax did you pay during 2025 for 2025? Enter 0 if none.`,
        'Usually paid in April, June and September. Your state tax account online lists them.',
      ),
    apply: (a, f) => {
      if (cents(a) === 0) return;
      f.stateReturn.estimatedPayments.push(cents(a));
      f.itemized.stateIncomeTaxPayments.push({ label: '2025 state estimated payments', amount: cents(a) });
    },
  },
  {
    id: 'state-estimate-january',
    sectionId: 'payments',
    applies: (c) => c.facts.residency.state !== null && !hasEstimateDocs(c, 'state_estimate'),
    build: (c) =>
      money(
        `How much ${stateName(c.facts.residency.state)} estimated tax for 2025 did you pay in January 2026? Enter 0 if none.`,
        'It counts as a payment on your 2025 state return.',
      ),
    apply: (a, f) => {
      if (cents(a) > 0) f.stateReturn.estimatedPayments.push(cents(a));
    },
  },
  {
    id: 'state-estimate-prior-january',
    sectionId: 'deductions',
    applies: (c) => c.facts.residency.state !== null && !hasEstimateDocs(c, 'state_estimate'),
    build: (c) =>
      money(
        `How much ${stateName(c.facts.residency.state)} estimated tax for 2024 did you pay in January 2025? Enter 0 if none.`,
        'State tax you paid during 2025 counts toward this year’s state and local tax deduction, even if it was for 2024.',
      ),
    apply: (a, f) => {
      if (cents(a) > 0) f.itemized.stateIncomeTaxPayments.push({ label: '2024 state estimate paid in January 2025', amount: cents(a) });
    },
  },
];
