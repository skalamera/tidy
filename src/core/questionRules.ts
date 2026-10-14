import { formatUsd, sumCents } from '../engine/money';
import type { MdCounty } from '../engine/params/md2025';
import type { PriorYearExtractionT } from '../shared/schemas/extraction';
import { parseAddress, parseName, ssnDigits } from '../shared/answers';
import type { FilingStatus, Person, TaxFacts } from '../shared/facts';
import type { AppState, Question, SectionId } from '../shared/state';
import { amountCents } from './amount';
import MD_SUBDIVISIONS from '../shared/data/md-subdivisions-2025.json';
import { MD_UNINCORPORATED_PLACES } from '../shared/data/md-unincorporated';

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

type Subdivision = (typeof MD_SUBDIVISIONS)[number];
const has = (s: string | null | undefined) => Boolean(s?.trim());
const needsSpouse = (c: RuleContext) => c.facts.filingStatus === 'mfj' || c.facts.filingStatus === 'mfs';
const noPerson = (): Person => ({ firstName: '', lastName: '', ssn: '', dateOfBirth: null });
const identity = (kind: 'name' | 'ssn' | 'address', prompt: string, help: string): QuestionDraft => ({
  kind,
  prompt,
  help,
  choices: null,
  suggested: null,
  blocking: true,
});

/** Last year's Maryland home, when the 2024 Form 502 showed a subdivision code Tidy knows. */
function priorHome(prior: PriorYearExtractionT | null): Subdivision | null {
  if (!prior || prior.residentState !== 'MD') return null;
  const code = (prior.mdSubdivisionCode ?? '').trim(); // returns read before Tidy asked for the code don't have it
  return MD_SUBDIVISIONS.find((d) => d.code === code) ?? null;
}
const placeName = (d: Subdivision) => (d.code.endsWith('00') ? countyLabel(d.county) : `${d.name}, ${countyLabel(d.county)}`);
function setHome(f: TaxFacts, d: Subdivision): void {
  f.residency.state = 'MD';
  f.residency.mdSubdivision = { code: d.code, name: d.code.endsWith('00') ? d.county : d.name };
  f.residency.mdCounty = d.county as MdCounty; // every county in the file has a local tax rate (tested)
}
/** Ask where they lived, unless they said they still live where the 2024 return says. */
const askWhere = (c: RuleContext) => priorHome(c.prior) === null || answerOf(c, 'residence-same') === 'no';
const exemptInterest = (f: TaxFacts) =>
  sumCents([...f.f1099Int.map((x) => x.box8TaxExemptInterest), ...f.f1099Div.map((x) => x.box12ExemptInterestDividends)]);
/** True when an uploaded payment record already covers estimated payments of this kind. */
const hasEstimateDocs = (c: RuleContext, kind: 'federal_estimate' | 'state_estimate') =>
  c.state.documents.some((d) => d.status === 'done' && d.extractions.some((x) => x.form === 'payment' && x.data.kind === kind));

export const RULES: Rule[] = [
  {
    id: 'your-name',
    sectionId: 'profile',
    applies: (c) => !(has(c.prior?.taxpayer.firstName) && has(c.prior?.taxpayer.lastName)),
    build: () => identity('name', 'What’s your name?', 'Exactly as it appears on your Social Security card.'),
    apply: (a, f) => {
      const n = parseName(a);
      if (n) f.taxpayer = { ...f.taxpayer, firstName: n.first, lastName: n.last };
    },
  },
  {
    id: 'your-ssn',
    sectionId: 'profile',
    applies: (c) => ssnDigits(c.prior?.taxpayer.ssn ?? '') === null,
    build: () => identity('ssn', 'What’s your Social Security number?', 'It goes at the top of your return.'),
    apply: (a, f) => {
      const ssn = ssnDigits(a);
      if (ssn) f.taxpayer = { ...f.taxpayer, ssn };
    },
  },
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
    id: 'spouse-name',
    sectionId: 'profile',
    applies: (c) => needsSpouse(c) && !(has(c.prior?.spouse?.firstName) && has(c.prior?.spouse?.lastName)),
    build: () => identity('name', 'What’s your spouse’s name?', 'Exactly as it appears on their Social Security card.'),
    apply: (a, f) => {
      const n = parseName(a);
      if (n) f.spouse = { ...(f.spouse ?? noPerson()), firstName: n.first, lastName: n.last };
    },
  },
  {
    id: 'spouse-ssn',
    sectionId: 'profile',
    applies: (c) => needsSpouse(c) && ssnDigits(c.prior?.spouse?.ssn ?? '') === null,
    build: () => identity('ssn', 'What’s your spouse’s Social Security number?', 'It goes at the top of your return, next to their name.'),
    apply: (a, f) => {
      const ssn = ssnDigits(a);
      if (ssn) f.spouse = { ...(f.spouse ?? noPerson()), ssn };
    },
  },
  {
    id: 'home-address',
    sectionId: 'profile',
    applies: (c) => {
      const a = c.prior?.address;
      return !(a && has(a.street) && has(a.city) && has(a.state) && has(a.zip));
    },
    build: () =>
      identity('address', 'What’s your home address?', 'Where you live now. The IRS and Maryland mail letters and refund checks here.'),
    apply: (a, f) => {
      const home = parseAddress(a);
      if (home) f.address = home;
    },
  },
  {
    id: 'residence-same',
    sectionId: 'profile',
    applies: (c) => priorHome(c.prior) !== null,
    build: (c) =>
      yesNo(
        `Last year you lived in ${placeName(priorHome(c.prior)!)}. Did you still live there on December 31, 2025?`,
        'Your city or county sets your Maryland local tax rate.',
      ),
    apply: (a, f, prior) => {
      const home = priorHome(prior);
      if (a === 'yes' && home) setHome(f, home);
    },
  },
  {
    id: 'resident-state',
    sectionId: 'profile',
    applies: askWhere,
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
    applies: (c) => c.facts.residency.state === 'MD' && askWhere(c),
    build: () => ({
      kind: 'choice',
      prompt: 'Where did you live in Maryland on December 31, 2025?',
      help: 'Pick your city or town if you lived inside its limits; otherwise pick your county (for example Huntingtown is in Calvert County, not an incorporated town). This sets your local tax rate.',
      choices: MD_SUBDIVISIONS.map((d) => ({
        value: d.code,
        label: d.code.endsWith('00') ? `${countyLabel(d.county)} (not in a town)` : `${d.name} · ${countyLabel(d.county)}`,
        ...(d.code.endsWith('00') && MD_UNINCORPORATED_PLACES[d.county as MdCounty]
          ? { keywords: MD_UNINCORPORATED_PLACES[d.county as MdCounty].join(' ') }
          : {}),
      })),
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      const d = MD_SUBDIVISIONS.find((x) => x.code === a);
      if (d) setHome(f, d);
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
        'Besides wages, interest, dividends, stock or fund sales, pensions, IRAs, and Social Security, did you have any other income in 2025?',
        'For example a business, rental property, partnership or S corporation, or trust.',
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
    id: 'you-65',
    sectionId: 'profile',
    applies: (c) => answerOf(c, 'senior-or-blind') === 'yes',
    build: () =>
      yesNo('Were you born before January 2, 1961?', 'The IRS treats anyone born on or before January 1, 1961 as 65 or older for 2025.'),
    apply: (a, f) => {
      if (a === 'yes' && (!f.taxpayer.dateOfBirth || f.taxpayer.dateOfBirth >= '1961-01-02')) f.taxpayer.dateOfBirth = '1955-01-01';
    },
  },
  {
    id: 'you-blind',
    sectionId: 'profile',
    applies: (c) => answerOf(c, 'senior-or-blind') === 'yes',
    build: () =>
      yesNo(
        'Were you legally blind on December 31, 2025?',
        'Complete blindness, or vision no better than 20/200 in your better eye with glasses (or a field of vision of 20 degrees or less).',
      ),
    apply: (a, f) => {
      f.taxpayer.blind = a === 'yes';
    },
  },
  {
    id: 'spouse-65',
    sectionId: 'profile',
    applies: (c) => c.facts.filingStatus === 'mfj' && answerOf(c, 'senior-or-blind') === 'yes',
    build: () =>
      yesNo(
        'Was your spouse born before January 2, 1961?',
        'The IRS treats anyone born on or before January 1, 1961 as 65 or older for 2025.',
      ),
    apply: (a, f) => {
      if (a === 'yes' && f.spouse && (!f.spouse.dateOfBirth || f.spouse.dateOfBirth >= '1961-01-02')) f.spouse.dateOfBirth = '1955-01-01';
    },
  },
  {
    id: 'spouse-blind',
    sectionId: 'profile',
    applies: (c) => c.facts.filingStatus === 'mfj' && answerOf(c, 'senior-or-blind') === 'yes',
    build: () =>
      yesNo(
        'Was your spouse legally blind on December 31, 2025?',
        'Complete blindness, or vision no better than 20/200 in their better eye with glasses (or a field of vision of 20 degrees or less).',
      ),
    apply: (a, f) => {
      if (f.spouse) f.spouse.blind = a === 'yes';
    },
  },
  {
    id: 'ira-nondeductible-basis',
    sectionId: 'wages',
    applies: (c) => (c.facts.f1099R ?? []).some((r) => r.iraSepSimple && !/^[GHQRT]/.test(r.box7Codes)),
    build: () =>
      yesNo(
        'Have you (or your spouse) ever made nondeductible contributions to a traditional IRA (Form 8606)?',
        'Most people only made pre-tax IRA contributions or rolled over a 401(k) and answer “No”. If you have after-tax basis in a traditional IRA, part of your distribution is tax-free on Form 8606.',
      ),
    apply: (a, f) => {
      f.hasNondeductibleIraBasis = a === 'yes';
    },
  },
  {
    id: 'ira-qcd',
    sectionId: 'wages',
    applies: (c) => (c.facts.f1099R ?? []).some((r) => r.iraSepSimple && r.box2aTaxableAmount > 0 && !/^[GHQ]/.test(r.box7Codes)),
    build: () =>
      yesNo(
        'Did any of your IRA distribution go directly from the IRA to a qualified charity (a Qualified Charitable Distribution)?',
        'If you are 70½ or older, direct transfers from your IRA to a charity (up to $108,000 per person in 2025) are excluded from taxable income on Form 1040 line 4b.',
      ),
    apply: () => {},
  },
  {
    id: 'ira-qcd-amount',
    sectionId: 'wages',
    applies: (c) => answerOf(c, 'ira-qcd') === 'yes',
    build: () =>
      money(
        'How much of your 2025 IRA distributions was transferred directly to charity as a QCD?',
        'Enter the total Qualified Charitable Distribution amount. Tidy subtracts it on Form 1040 line 4b and checks the QCD box.',
      ),
    apply: (a, f) => {
      let rem = cents(a);
      for (const r of f.f1099R ?? []) {
        if (!r.iraSepSimple || r.box2aTaxableAmount <= 0 || rem <= 0) continue;
        const take = Math.min(rem, r.box2aTaxableAmount);
        r.qcdAmount = take;
        rem -= take;
      }
    },
  },
  {
    id: 'retirement-rollover',
    sectionId: 'wages',
    applies: (c) => (c.facts.f1099R ?? []).some((r) => r.box2aTaxableAmount > 0 && !/^[GH]/.test(r.box7Codes)),
    build: () =>
      yesNo(
        'Did you roll over any of your 2025 retirement distributions into another IRA or retirement plan within 60 days?',
        'Direct rollovers (code G) are already marked tax-free on your 1099-R. Answer “Yes” only if you received a distribution and rolled it over yourself.',
      ),
    apply: () => {},
  },
  {
    id: 'retirement-rollover-amount',
    sectionId: 'wages',
    applies: (c) => answerOf(c, 'retirement-rollover') === 'yes',
    build: () =>
      money(
        'How much did you roll over into another retirement account?',
        'Tidy subtracts this rollover on Form 1040 line 4b or 5b and checks the Rollover box.',
      ),
    apply: (a, f) => {
      let rem = cents(a);
      for (const r of f.f1099R ?? []) {
        if (r.box2aTaxableAmount <= 0 || /^[GH]/.test(r.box7Codes) || rem <= 0) continue;
        const avail = Math.max(0, r.box2aTaxableAmount - (r.qcdAmount ?? 0));
        const take = Math.min(rem, avail);
        r.rolloverAmount = take;
        rem -= take;
      }
    },
  },
  {
    id: 'md-pension-disability',
    sectionId: 'state_summary',
    applies: (c) =>
      c.facts.residency.state === 'MD' &&
      (c.facts.f1099R ?? []).some((r) => !r.iraSepSimple && r.box2aTaxableAmount > 0) &&
      !(c.facts.taxpayer.dateOfBirth && c.facts.taxpayer.dateOfBirth < '1961-01-02'),
    build: () =>
      yesNo(
        'Were you totally and permanently disabled on December 31, 2025?',
        'Maryland allows the pension exclusion (up to $41,200) for taxpayers under 65 who are totally and permanently disabled.',
      ),
    apply: (a, f) => {
      f.taxpayer.totallyDisabled = a === 'yes';
    },
  },
  {
    id: 'capital-loss-carryover',
    sectionId: 'investments',
    applies: (c) =>
      c.prior === null && ((c.facts.f1099B ?? []).length > 0 || c.facts.f1099Div.some((x) => x.box2aCapitalGainDistributions > 0)),
    build: () =>
      yesNo(
        'Do you have an unused capital loss carryover from your 2024 tax return?',
        'If your capital losses in an earlier year exceeded the $3,000 ($1,500 married filing separately) limit, the rest carries forward to 2025.',
      ),
    apply: () => {},
  },
  {
    id: 'capital-loss-carryover-st',
    sectionId: 'investments',
    applies: (c) => answerOf(c, 'capital-loss-carryover') === 'yes',
    build: () =>
      money(
        'How much is your short-term capital loss carryover from 2024 to 2025? Enter 0 if none.',
        'Line 8 of the Capital Loss Carryover Worksheet in the Schedule D instructions.',
      ),
    apply: (a, f) => {
      f.carryovers = {
        capitalLossShortTerm: Math.abs(cents(a)),
        capitalLossLongTerm: f.carryovers?.capitalLossLongTerm ?? 0,
        qbiLoss: f.carryovers?.qbiLoss ?? 0,
        reitPtpLoss: f.carryovers?.reitPtpLoss ?? 0,
      };
    },
  },
  {
    id: 'capital-loss-carryover-lt',
    sectionId: 'investments',
    applies: (c) => answerOf(c, 'capital-loss-carryover') === 'yes',
    build: () =>
      money(
        'How much is your long-term capital loss carryover from 2024 to 2025? Enter 0 if none.',
        'Line 13 of the Capital Loss Carryover Worksheet in the Schedule D instructions.',
      ),
    apply: (a, f) => {
      f.carryovers = {
        capitalLossShortTerm: f.carryovers?.capitalLossShortTerm ?? 0,
        capitalLossLongTerm: Math.abs(cents(a)),
        qbiLoss: f.carryovers?.qbiLoss ?? 0,
        reitPtpLoss: f.carryovers?.reitPtpLoss ?? 0,
      };
    },
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
