import { formatUsd, sumCents } from '../engine/money';
import type { MdCounty } from '../engine/params/md2025';
import type { PriorYearExtractionT } from '../shared/schemas/extraction';
import { parseAddress, parseLines, parseName, ssnDigits } from '../shared/answers';
import type { FilingStatus, Person, ScheduleCBusiness, TaxFacts } from '../shared/facts';
import type { AppState, Question, SectionId } from '../shared/state';
import { amountCents } from './amount';
import { refundKnownFromDocuments } from './deriveFacts';
import { isIraDistribution, reportedTaxable } from '../engine/federal/retirement';
import { foreignTaxPaid, simpleForeignTaxCreditAllowed } from '../engine/federal/schedule3';
import { isMdOnlyW2 } from '../engine/md/form502';
import { FEDERAL_WINDOWS, STATE_WINDOWS, suggestedPriorYearStatePayments, suggestedWindows } from './estimates';
import MD_SUBDIVISIONS from '../shared/data/md-subdivisions-2025.json';
import SC_CODES from '../shared/data/schedule-c-codes-2025.json';
import { MD_UNINCORPORATED_PLACES } from '../shared/data/md-unincorporated';

export interface RuleContext {
  state: AppState;
  facts: TaxFacts;
  prior: PriorYearExtractionT | null;
}

export type QuestionDraft = Pick<Question, 'kind' | 'prompt' | 'help' | 'choices' | 'suggested' | 'blocking' | 'suggestedLines'>;

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
const newDeductions = (f: TaxFacts) => (f.newDeductions ??= { tips: 0, overtime: 0, carLoans: [] });
/** The i-th new-vehicle loan of Schedule 1-A Part IV, created on first use. */
const carLoan = (f: TaxFacts, i: number) => {
  const loans = newDeductions(f).carLoans;
  while (loans.length <= i) loans.push({ vin: '', interest: 0 });
  return loans[i]!;
};
const vinQuestion = (prompt: string): QuestionDraft => ({
  kind: 'text',
  prompt,
  help: 'The 17 characters on your registration, insurance card or loan statement. Schedule 1-A needs it.',
  choices: null,
  suggested: null,
  blocking: true,
});
const stateName = (s: string | null) => (s === 'MD' ? 'Maryland' : 'your state');

const HOME_OFFICE_LINES = [
  { value: 'businessSqFt', label: 'The space you use for the business' },
  { value: 'totalSqFt', label: 'Your whole home' },
];

const medicalLines = (f: TaxFacts) => [
  { value: 'premiums', label: 'Health insurance you paid for yourself, including Medicare and Medigap' },
  { value: 'ltcYou', label: f.filingStatus === 'mfj' ? 'Long-term care insurance (yours)' : 'Long-term care insurance' },
  ...(f.filingStatus === 'mfj' ? [{ value: 'ltcSpouse', label: 'Long-term care insurance (your spouse’s)' }] : []),
  { value: 'other', label: 'Doctors, dentists, hospitals, prescriptions, glasses, hearing aids and other care' },
];
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
/** Help for a payments-by-date question: where its starting values came from. */
const fromRecords = (s: { records: number; undated: number }, otherwise: string) =>
  s.records === 0
    ? otherwise
    : `Filled in from ${s.records === 1 ? 'the payment record' : `${s.records} payment records`} you uploaded. Check them against your online account and add any payment that’s missing.${
        s.undated
          ? ` ${s.undated === 1 ? 'One record has' : `${s.undated} records have`} no date, so add ${s.undated === 1 ? 'it' : 'them'} yourself.`
          : ''
      }`;

/** Schedule C Part II lines (depreciation and depletion need Form 4562, which Tidy doesn't fill in yet). */
export const BUSINESS_EXPENSE_LINES = [
  { value: 'advertising', label: 'Advertising (line 8)' },
  { value: 'carAndTruck', label: 'Car and truck expenses (line 9)' },
  { value: 'commissionsAndFees', label: 'Commissions and fees (line 10)' },
  { value: 'contractLabor', label: 'Contract labor (line 11)' },
  { value: 'employeeBenefitPrograms', label: 'Employee benefit programs (line 14)' },
  { value: 'insurance', label: 'Insurance, other than health (line 15)' },
  { value: 'interestMortgage', label: 'Mortgage interest paid to banks (line 16a)' },
  { value: 'interestOther', label: 'Other interest (line 16b)' },
  { value: 'legalAndProfessional', label: 'Legal and professional services (line 17)' },
  { value: 'officeExpense', label: 'Office expense (line 18)' },
  { value: 'pensionAndProfitSharing', label: 'Pension and profit-sharing plans for employees (line 19)' },
  { value: 'rentVehiclesMachinery', label: 'Rent or lease of vehicles and equipment (line 20a)' },
  { value: 'rentOtherBusinessProperty', label: 'Rent or lease of other business property (line 20b)' },
  { value: 'repairsAndMaintenance', label: 'Repairs and maintenance (line 21)' },
  { value: 'supplies', label: 'Supplies (line 22)' },
  { value: 'taxesAndLicenses', label: 'Taxes and licenses (line 23)' },
  { value: 'travel', label: 'Travel (line 24a)' },
  { value: 'deductibleMeals', label: 'Business meals: half of what you spent (line 24b)' },
  { value: 'utilities', label: 'Utilities (line 25)' },
  { value: 'wages', label: 'Wages paid to employees (line 26)' },
  { value: 'otherExpenses', label: 'Other expenses (line 27b, listed in Part V)' },
] as const;

const SCHEDULE_C_CODES = SC_CODES as { code: string; label: string; group: string }[];

/** The active business, made when an answer first needs it (a 1099-NEC's owner runs it until told otherwise). */
function business(f: TaxFacts): ScheduleCBusiness {
  const active = (f.scheduleC ?? []).find((b) => !b.closedInPriorYear);
  if (active) return active;
  const b: ScheduleCBusiness = {
    id: 'schc-auto',
    owner: f.f1099Nec?.[0]?.owner ?? 'taxpayer',
    principalBusiness: '',
    businessCode: '',
    isSstb: false,
    expenses: {},
  };
  f.scheduleC = [...(f.scheduleC ?? []), b];
  return b;
}

const hasBusiness = (c: RuleContext) =>
  (c.facts.f1099Nec ?? []).length > 0 ||
  (Boolean(c.prior?.scheduleC) && answerOf(c, 'business-active-2025') === 'yes') ||
  answerOf(c, 'business-new') === 'yes';

const businessName = (c: RuleContext) => {
  const b = (c.facts.scheduleC ?? []).find((x) => !x.closedInPriorYear);
  const name = b?.businessName?.trim() || b?.principalBusiness?.trim();
  return name ? `“${name}”` : 'your business';
};

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
    applies: () => true,
    build: () =>
      yesNo(
        'At any time in 2025, did you have a bank or investment account outside the U.S.?',
        'Schedule B asks everyone with a foreign account, whatever its interest. Accounts at U.S. firms that hold foreign stocks don’t count.',
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
    id: 'state-refund',
    sectionId: 'wages',
    // Asked unless documents say (a 1099-G, or the 2024 state return), or the 2024 return shows it can't be taxable.
    applies: (c) =>
      !refundKnownFromDocuments(c.facts, c.prior) && c.prior?.itemized !== null && c.prior?.itemized?.salesTaxElected !== true,
    build: () =>
      yesNo(
        'Did you get a refund of 2024 state or local income tax during 2025, or apply one to your 2025 estimated tax?',
        'Part of it can be taxable if you itemized deductions on your 2024 return. A 1099-G from the state shows it.',
      ),
    apply: () => {},
  },
  {
    id: 'state-refund-amount',
    sectionId: 'wages',
    applies: (c) => answerOf(c, 'state-refund') === 'yes',
    build: () =>
      money(
        'How much was it, including any amount you applied to your 2025 estimated tax?',
        'Box 2 of your 1099-G, or your state tax account online.',
      ),
    apply: (a, f) => {
      if (f.stateRefund) f.stateRefund.refund = Math.max(0, cents(a));
    },
  },
  {
    id: 'prior-itemized',
    sectionId: 'wages',
    applies: (c) => (c.facts.stateRefund?.refund ?? 0) > 0 && (c.prior === null || c.prior.itemized === undefined),
    build: () =>
      yesNo(
        'Did you itemize deductions on your 2024 federal return (Schedule A)?',
        'If you took the standard deduction, none of your 2024 state refund is taxable.',
      ),
    apply: () => {}, // "yes" needs the 2024 Schedule A (flags)
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
        'Besides wages, self-employment / consulting, rentals, partnerships / S corporations / trusts (Schedule K-1), interest, dividends, stock or fund sales, pensions, IRAs, and Social Security, did you have any other income in 2025?',
        'For example farm income (Schedule F), alimony received under a pre-2019 agreement, or gambling winnings.',
      ),
    apply: () => {},
  },
  {
    id: 'rentals-other',
    sectionId: 'wages',
    applies: () => true,
    build: (c) => {
      const known = (c.facts.rentals ?? []).map((r) => r.address.trim()).filter(Boolean);
      return yesNo(
        known.length
          ? `Besides ${known.join(' and ')}, did you own any other rental property, or get royalties, in 2025?`
          : 'Did you own rental property, or get royalties, in 2025?',
        'Rent and royalties go on Schedule E. Count a vacation home you rented out for 15 days or more.',
      );
    },
    apply: () => {},
  },
  {
    id: 'your-birth-date',
    sectionId: 'profile',
    applies: () => true,
    build: () => ({
      kind: 'date',
      prompt: 'What’s your date of birth?',
      help: 'Turning 65 by the end of 2025 means a larger standard deduction, the new senior deduction and Maryland’s pension exclusion. Some limits also go by age.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      f.taxpayer.dateOfBirth = a;
    },
  },
  {
    id: 'spouse-birth-date',
    sectionId: 'profile',
    applies: (c) => c.facts.filingStatus === 'mfj',
    build: () => ({
      kind: 'date',
      prompt: 'What’s your spouse’s date of birth?',
      help: 'Your spouse’s age counts on a joint return too.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      if (f.spouse) f.spouse.dateOfBirth = a;
    },
  },
  {
    id: 'anyone-blind',
    sectionId: 'profile',
    applies: () => true,
    build: (c) =>
      yesNo(
        c.facts.filingStatus === 'mfj'
          ? 'Was either of you legally blind on December 31, 2025?'
          : 'Were you legally blind on December 31, 2025?',
        'Vision no better than 20/200 in the better eye with glasses, or a field of vision of 20 degrees or less. It adds to the standard deduction.',
      ),
    apply: (a, f) => {
      if (f.filingStatus !== 'mfj') f.taxpayer.blind = a === 'yes';
    },
  },
  {
    id: 'you-blind',
    sectionId: 'profile',
    applies: (c) => c.facts.filingStatus === 'mfj' && answerOf(c, 'anyone-blind') === 'yes',
    build: () => yesNo('Were you legally blind on December 31, 2025?', 'Answer for yourself; the next question asks about your spouse.'),
    apply: (a, f) => {
      f.taxpayer.blind = a === 'yes';
    },
  },
  {
    id: 'spouse-blind',
    sectionId: 'profile',
    applies: (c) => c.facts.filingStatus === 'mfj' && answerOf(c, 'anyone-blind') === 'yes',
    build: () =>
      yesNo(
        'Was your spouse legally blind on December 31, 2025?',
        'Vision no better than 20/200 in the better eye with glasses, or a field of vision of 20 degrees or less.',
      ),
    apply: (a, f) => {
      if (f.spouse) f.spouse.blind = a === 'yes';
    },
  },
  {
    id: 'business-active-2025',
    sectionId: 'wages',
    applies: (c) => Boolean(c.prior?.scheduleC) && (c.facts.f1099Nec ?? []).length === 0,
    build: (c) =>
      yesNo(
        `Your 2024 return included a Schedule C business (${c.prior!.scheduleC!.businessName || c.prior!.scheduleC!.principalBusiness}). Did that business operate or close during 2025?`,
        'Answer “No” if the business already closed in 2024 with no 2025 income, expenses, or asset sales.',
      ),
    apply: (a, f) => {
      if (a === 'no' && f.scheduleC?.[0]) f.scheduleC[0].closedInPriorYear = true;
    },
  },
  {
    id: 'business-new',
    sectionId: 'wages',
    applies: (c) => !c.prior?.scheduleC && (c.facts.f1099Nec ?? []).length === 0,
    build: () =>
      yesNo(
        'Did you have income in 2025 from your own business or freelance work?',
        'For example consulting, gig or app work, or sales paid to you directly instead of as wages. Income on a 1099-NEC counts too: upload it.',
      ),
    apply: (a, f) => {
      if (a === 'yes') business(f);
    },
  },
  {
    id: 'business-owner',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c) && needsSpouse(c) && new Set((c.facts.f1099Nec ?? []).map((n) => n.owner)).size !== 1,
    build: (c) => ({
      kind: 'choice',
      prompt: `Whose business is ${businessName(c)}?`,
      help: 'Schedule C and self-employment tax go under the name of the person who runs it.',
      choices: [
        { value: 'taxpayer', label: `${c.facts.taxpayer.firstName.trim() || 'Me'} (you)` },
        { value: 'spouse', label: `${c.facts.spouse?.firstName.trim() || 'My spouse'} (your spouse)` },
      ],
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      if (a === 'taxpayer' || a === 'spouse') business(f).owner = a;
    },
  },
  {
    id: 'business-what',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c) && !has(c.prior?.scheduleC?.principalBusiness),
    build: () => ({
      kind: 'text',
      prompt: 'What does your business do, in a few words?',
      help: 'Printed on Schedule C line A, like “Management consulting” or “Graphic design”.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      business(f).principalBusiness = a.slice(0, 60);
    },
  },
  {
    id: 'business-code',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c) && !/^\d{6}$/.test(c.prior?.scheduleC?.businessCode ?? ''),
    build: () => ({
      kind: 'choice',
      prompt: 'Which of these best describes your business?',
      help: 'Schedule C line B takes the IRS code for it. Type a word or two, like “consulting” or “design”.',
      choices: SCHEDULE_C_CODES.map((x) => ({ value: x.code, label: `${x.label} (${x.code})`, keywords: x.group })),
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      if (SCHEDULE_C_CODES.some((x) => x.code === a)) business(f).businessCode = a;
    },
  },
  {
    id: 'business-sstb',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: (c) =>
      yesNo(
        `Is ${businessName(c)} in health, law, accounting, actuarial science, performing arts, consulting, athletics, financial services or brokerage?`,
        'Those are “specified service” businesses. Above an income limit they get less of the 20% qualified business income deduction.',
      ),
    apply: (a, f) => {
      business(f).isSstb = a === 'yes';
    },
  },
  {
    id: 'business-additional-receipts',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: (c) =>
      money(
        (c.facts.f1099Nec ?? []).length > 0
          ? 'Besides your Form 1099-NEC income, how much other gross receipts or sales did your business collect in 2025? Enter 0 if none.'
          : 'How much gross receipts or sales did your business collect in 2025? Enter 0 if none.',
        'Include fees and sales not on a 1099-NEC, like cash, card or app payments (a 1099-K counts here).',
      ),
    apply: (a, f) => {
      business(f).additionalGrossReceipts = cents(a);
    },
  },
  {
    id: 'business-expenses',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: (c) => ({
      kind: 'lines',
      prompt: `What did ${businessName(c)} spend in 2025?`,
      help: 'Leave a line blank if it’s 0. Don’t include a home office, retirement plan contributions for yourself, or your own health insurance: Tidy asks about those separately.',
      choices: [...BUSINESS_EXPENSE_LINES],
      suggested: null,
      blocking: true,
    }),
    apply: (a, f) => {
      const lines = parseLines(a, BUSINESS_EXPENSE_LINES);
      if (!lines) return;
      const b = business(f);
      const { otherExpenses: other, ...partII } = lines;
      b.expenses = { ...b.expenses, ...partII };
      b.otherExpenses = other ? [{ description: 'Other business expenses', amount: other }] : [];
    },
  },
  {
    id: 'business-home-office',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: (c) =>
      yesNo(
        `Did you use part of your home regularly and only for ${businessName(c)} in 2025?`,
        'Tidy takes the simplified home office deduction: $5 a square foot for up to 300 square feet (Schedule C line 30).',
      ),
    apply: (_a, f) => {
      business(f).homeOffice = null; // the area answer sets it
    },
  },
  {
    id: 'business-home-office-area',
    sectionId: 'wages',
    applies: (c) => answerOf(c, 'business-home-office') === 'yes',
    build: (c) => {
      const p = c.prior?.scheduleC;
      return {
        kind: 'area',
        prompt: 'How many square feet is that space, and your whole home?',
        help: p?.homeOfficeBusinessSqFt ? 'Filled in from your 2024 return.' : 'Measure the space you use only for the business.',
        choices: HOME_OFFICE_LINES,
        suggested: null,
        suggestedLines:
          p?.homeOfficeBusinessSqFt && p.homeOfficeTotalSqFt
            ? { businessSqFt: p.homeOfficeBusinessSqFt, totalSqFt: p.homeOfficeTotalSqFt }
            : null,
        blocking: true,
      };
    },
    apply: (a, f) => {
      const v = parseLines(a, HOME_OFFICE_LINES, 'area');
      const biz = v?.businessSqFt ?? 0;
      const total = v?.totalSqFt ?? 0;
      business(f).homeOffice = biz > 0 && total >= biz ? { method: 'simplified', businessSqFt: biz, totalSqFt: total } : null;
    },
  },
  {
    id: 'business-assets',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: (c) =>
      yesNo(
        `Did ${businessName(c)} own equipment, a vehicle or property it depreciates, or sell or scrap any in 2025?`,
        'That needs Form 4562 or Form 4797.',
      ),
    apply: () => {}, // "yes" blocks (flags)
  },
  {
    id: 'business-sep',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: () =>
      money(
        'How much did you contribute to a self-employed SEP, SIMPLE, or solo 401(k) plan for 2025? Enter 0 if none.',
        'Tidy caps the deduction at the 2025 statutory limit (20% of net self-employment earnings after half of SE tax, up to $70,000) on Schedule 1, line 16.',
      ),
    apply: (a, f) => {
      if (cents(a) > 0) business(f).sepContribution = cents(a);
    },
  },
  {
    id: 'business-health-insurance',
    sectionId: 'wages',
    applies: (c) => hasBusiness(c),
    build: () =>
      money(
        'How much did you pay in 2025 for self-employed health insurance premiums under your business (for months you weren’t eligible for an employer plan)? Enter 0 if none.',
        'Reported on Form 7206 and deducted on Schedule 1, line 17, up to your net business profit after SE tax and SEP.',
      ),
    apply: (a, f) => {
      if (cents(a) > 0) business(f).healthInsurancePremiums = cents(a);
    },
  },
  {
    id: 'medical-expenses',
    sectionId: 'deductions',
    applies: () => true,
    build: (c) => {
      const medicare = sumCents((c.facts.ssa1099 ?? []).map((x) => x.medicarePremiums ?? 0));
      return {
        kind: 'lines',
        prompt: 'What medical and dental costs did you pay in 2025 that insurance didn’t cover? Leave the lines blank if none.',
        help:
          medicare > 0
            ? 'Filled in with the Medicare premiums on your SSA-1099. Medical costs count only if you itemize, and only the part over 7.5% of your income. Leave out anything paid with pre-tax money through work.'
            : 'They count only if you itemize, and only the part over 7.5% of your income. Leave out anything paid with pre-tax money through work.',
        choices: medicalLines(c.facts),
        suggested: null,
        suggestedLines: medicare > 0 ? { premiums: medicare } : null,
        blocking: true,
      };
    },
    apply: (a, f) => {
      const v = parseLines(a, medicalLines(f));
      if (!v) return;
      f.itemized.medicalExpenses = Math.max(0, v.premiums ?? 0) + Math.max(0, v.other ?? 0);
      f.itemized.longTermCarePremiums = { taxpayer: Math.max(0, v.ltcYou ?? 0), spouse: Math.max(0, v.ltcSpouse ?? 0) };
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
    id: 'foreign-tax-credit',
    sectionId: 'investments',
    applies: (c) => simpleForeignTaxCreditAllowed(c.facts),
    build: (c) =>
      yesNo(
        `Your 1099s show ${formatUsd(foreignTaxPaid(c.facts), { cents: true })} of foreign tax. Can Tidy claim it as a credit?`,
        'Yes for almost everyone with funds or shares: you owned them for more than 15 days around each payment, the tax was owed and not refundable, it went to a country the U.S. recognizes, and you aren’t excluding income from Puerto Rico. Tidy then claims it on Schedule 3 line 1, without Form 1116.',
      ),
    apply: (a, f) => {
      f.claimForeignTaxCredit = a === 'yes';
    },
  },
  {
    id: 'tips-2025',
    sectionId: 'wages',
    applies: (c) => c.facts.w2s.length > 0 && c.facts.filingStatus !== 'mfs',
    build: () =>
      yesNo(
        'Did you get tips in 2025, in a job where people usually get tips?',
        'Like restaurant servers, bartenders, hair stylists and delivery drivers (the list is at IRS.gov/TippedOccupations). For 2025, up to $25,000 of tips is deductible on Schedule 1-A.',
      ),
    apply: () => {},
  },
  {
    id: 'tips-amount',
    sectionId: 'wages',
    applies: (c) => answerOf(c, 'tips-2025') === 'yes',
    build: () =>
      money(
        'How much in tips did your W-2s show in box 7 (social security tips)?',
        'Count only tips customers chose to give, not automatic service charges. Tidy deducts up to $25,000, less $100 for each $1,000 of income over $150,000 ($300,000 joint).',
      ),
    apply: (a, f) => {
      newDeductions(f).tips = cents(a);
    },
  },
  {
    id: 'overtime-2025',
    sectionId: 'wages',
    applies: (c) => c.facts.w2s.length > 0 && c.facts.filingStatus !== 'mfs',
    build: () =>
      yesNo(
        'Were you paid overtime in 2025, at time-and-a-half for hours over 40 a week?',
        'For 2025 the extra half of overtime pay required by federal law is deductible on Schedule 1-A, up to $12,500 ($25,000 joint).',
      ),
    apply: () => {},
  },
  {
    id: 'overtime-amount',
    sectionId: 'wages',
    applies: (c) => answerOf(c, 'overtime-2025') === 'yes',
    build: () =>
      money(
        'How much of your 2025 pay was the extra half of overtime?',
        'Your employer may show it in box 14 of your W-2 or on a separate statement. If you only know your total overtime pay at time-and-a-half, enter a third of it. Tidy deducts it less $100 for each $1,000 of income over $150,000 ($300,000 joint).',
      ),
    apply: (a, f) => {
      newDeductions(f).overtime = cents(a);
    },
  },
  {
    id: 'car-loan-2025',
    sectionId: 'deductions',
    applies: () => true,
    build: () =>
      yesNo(
        'Did you pay interest in 2025 on a loan for a new car, SUV, pickup or motorcycle?',
        'It counts when the vehicle is new, for personal use, had its final assembly in the U.S., and was bought after 2024 with a loan secured by it. Up to $10,000 of the interest is deductible for 2025 (Schedule 1-A). Your lender’s statement shows the interest.',
      ),
    apply: () => {},
  },
  {
    id: 'car-loan-vin',
    sectionId: 'deductions',
    applies: (c) => answerOf(c, 'car-loan-2025') === 'yes',
    build: () => vinQuestion('What is that vehicle’s identification number (VIN)?'),
    apply: (a, f) => {
      carLoan(f, 0).vin = a.trim().toUpperCase();
    },
  },
  {
    id: 'car-loan-interest',
    sectionId: 'deductions',
    applies: (c) => answerOf(c, 'car-loan-2025') === 'yes',
    build: () =>
      money(
        'How much interest did you pay on that loan in 2025?',
        'From your lender’s year-end statement. Leave out any interest you deducted on Schedule C or E. Tidy deducts up to $10,000, less $200 for each $1,000 (or part) of income over $100,000 ($200,000 joint).',
      ),
    apply: (a, f) => {
      carLoan(f, 0).interest = cents(a);
    },
  },
  {
    id: 'car-loan-second',
    sectionId: 'deductions',
    applies: (c) => answerOf(c, 'car-loan-2025') === 'yes',
    build: () => yesNo('Did you pay interest on a loan like that for a second new vehicle?', 'Schedule 1-A has room for two vehicles.'),
    apply: () => {},
  },
  {
    id: 'car-loan-vin-2',
    sectionId: 'deductions',
    applies: (c) => answerOf(c, 'car-loan-2025') === 'yes' && answerOf(c, 'car-loan-second') === 'yes',
    build: () => vinQuestion('What is the second vehicle’s identification number (VIN)?'),
    apply: (a, f) => {
      carLoan(f, 1).vin = a.trim().toUpperCase();
    },
  },
  {
    id: 'car-loan-interest-2',
    sectionId: 'deductions',
    applies: (c) => answerOf(c, 'car-loan-2025') === 'yes' && answerOf(c, 'car-loan-second') === 'yes',
    build: () => money('How much interest did you pay on the second vehicle’s loan in 2025?', 'From your lender’s year-end statement.'),
    apply: (a, f) => {
      carLoan(f, 1).interest = cents(a);
    },
  },
  {
    id: 'ira-qcd',
    sectionId: 'wages',
    applies: (c) => (c.facts.f1099R ?? []).some((r) => r.iraSepSimple && reportedTaxable(r) > 0 && !/^[GHQ]/.test(r.box7Codes)),
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
        if (!r.iraSepSimple || reportedTaxable(r) <= 0 || rem <= 0) continue;
        const take = Math.min(rem, reportedTaxable(r));
        r.qcdAmount = take;
        rem -= take;
      }
    },
  },
  {
    id: 'retirement-rollover',
    sectionId: 'wages',
    applies: (c) => (c.facts.f1099R ?? []).some((r) => reportedTaxable(r) > 0 && !/^[GH]/.test(r.box7Codes)),
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
        if (reportedTaxable(r) <= 0 || /^[GH]/.test(r.box7Codes) || rem <= 0) continue;
        const avail = Math.max(0, reportedTaxable(r) - (r.qcdAmount ?? 0));
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
      (c.facts.f1099R ?? []).some((r) => !isIraDistribution(r) && reportedTaxable(r) > 0) &&
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
    applies: (c) => c.prior === null, // a carryover gives a deduction even with no sales in 2025
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
        capitalLossLongTerm: 0,
        qbiLoss: 0,
        reitPtpLoss: 0,
        ...f.carryovers,
        capitalLossShortTerm: Math.abs(cents(a)),
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
        capitalLossShortTerm: 0,
        qbiLoss: 0,
        reitPtpLoss: 0,
        ...f.carryovers,
        capitalLossLongTerm: Math.abs(cents(a)),
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
    applies: () => true,
    build: (c) => {
      const s = suggestedWindows(c.state, 'federal_estimate');
      return {
        kind: 'lines',
        prompt: 'How much federal estimated tax did you pay for 2025, and when? Leave the lines blank if you paid none.',
        help: fromRecords(
          s,
          'Your IRS online account (irs.gov/account) lists every payment. When you paid matters for the underpayment penalty.',
        ),
        choices: FEDERAL_WINDOWS,
        suggested: null,
        suggestedLines: s.records > 0 ? s.lines : null,
        blocking: true,
      };
    },
    apply: (a, f) => {
      const v = parseLines(a, FEDERAL_WINDOWS);
      if (!v) return;
      const by = (k: string) => v[k] ?? 0;
      f.payments.federalEstimated = FEDERAL_WINDOWS.map((w) => by(w.value)).filter((x) => x > 0);
      f.payments.federalEstimatedByQuarter = [by('q1'), by('q2'), by('q3'), by('q4')];
    },
  },
  {
    id: 'state-estimates',
    sectionId: 'payments',
    applies: (c) => c.facts.residency.state !== null,
    build: (c) => {
      const s = suggestedWindows(c.state, 'state_estimate', c.facts.residency.state);
      return {
        kind: 'lines',
        prompt: `How much ${stateName(c.facts.residency.state)} estimated tax did you pay for 2025, and when? Leave the lines blank if you paid none.`,
        help: fromRecords(
          s,
          'Your state tax account online lists them. What you paid during 2025 also counts toward your state and local tax deduction.',
        ),
        choices: STATE_WINDOWS,
        suggested: null,
        suggestedLines: s.records > 0 ? s.lines : null,
        blocking: true,
      };
    },
    apply: (a, f) => {
      const v = parseLines(a, STATE_WINDOWS);
      if (!v) return;
      const by = (k: string) => v[k] ?? 0;
      f.stateReturn.estimatedPayments = STATE_WINDOWS.map((w) => by(w.value)).filter((x) => x > 0);
      f.stateReturn.estimatedByQuarter = [by('q1'), by('q2'), by('q3'), by('q4a') + by('q4b')];
      const paidIn2025 = by('q1') + by('q2') + by('q3') + by('q4a');
      if (paidIn2025 > 0)
        f.itemized.stateIncomeTaxPayments.push({ label: '2025 state estimated payments made in 2025', amount: paidIn2025 });
    },
  },
  {
    id: 'state-estimate-prior-january',
    sectionId: 'deductions',
    applies: (c) => c.facts.residency.state !== null,
    build: (c) => {
      const s = suggestedPriorYearStatePayments(c.state, c.facts.residency.state);
      return {
        ...money(
          `How much ${stateName(c.facts.residency.state)} estimated tax for 2024 did you pay during 2025, usually in January? Enter 0 if none.`,
          s === null
            ? 'State tax you paid during 2025 counts toward this year’s state and local tax deduction, even if it was for 2024.'
            : 'Filled in from the payment records you uploaded. State tax you paid during 2025 counts toward this year’s deduction, even if it was for 2024.',
        ),
        suggested: s ?? 0,
      };
    },
    apply: (a, f) => {
      if (cents(a) > 0) f.itemized.stateIncomeTaxPayments.push({ label: '2024 state estimate paid in 2025', amount: cents(a) });
    },
  },
  {
    id: 'compute-form-2210',
    sectionId: 'payments',
    applies: (c) => {
      const f = c.facts;
      const withheld =
        sumCents(f.w2s.map((x) => x.box2FedWithheld)) +
        sumCents(f.f1099Int.map((x) => x.box4FedWithheld)) +
        sumCents(f.f1099Div.map((x) => x.box4FedWithheld)) +
        sumCents((f.f1099B ?? []).map((x) => x.box4FedWithheld)) +
        sumCents((f.f1099R ?? []).map((x) => x.box4FedWithheld)) +
        sumCents((f.f1099Nec ?? []).map((x) => x.box4FedWithheld)) +
        sumCents((f.f1099G ?? []).map((x) => x.box4FedWithheld)) +
        sumCents((f.ssa1099 ?? []).map((x) => x.box6FedWithheld));
      const est = sumCents(f.payments.federalEstimated) + f.payments.federalPriorYearApplied;
      const priorTax = f.payments.priorYearFederalTax ?? null;
      const priorAgi = f.payments.priorYearFederalAgi ?? 0;
      const reqPrior = priorTax !== null && priorTax > 0 ? Math.round((priorTax * (priorAgi > 15_000_000 ? 110 : 100)) / 100) : null;
      return reqPrior !== null && withheld + est < reqPrior && reqPrior - withheld >= 100_000;
    },
    build: () =>
      yesNo(
        'Do you want Tidy to calculate the federal estimated tax penalty (Form 2210) on your return?',
        'The IRS usually figures any underpayment penalty for you and sends a bill, so most people answer “No” unless they are requesting a waiver or filing Form 2210.',
      ),
    apply: (a, f) => {
      f.payments.computeForm2210 = a === 'yes';
    },
  },
  {
    id: 'compute-md-502up',
    sectionId: 'payments',
    applies: (c) => {
      const f = c.facts;
      if (f.residency.state !== 'MD') return false;
      const priorMdTax = f.stateReturn.priorYearMdTax ?? null;
      if (priorMdTax === null || priorMdTax <= 0) return false;
      const mdWithheld = sumCents([
        ...f.w2s.flatMap((w) => [
          ...w.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax),
          ...(isMdOnlyW2(w) ? w.localLines.map((x) => x.localTax) : []),
        ]),
        ...(f.f1099R ?? []).flatMap((r) => r.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax)),
        ...(f.f1099Nec ?? []).flatMap((n) => n.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax)),
        ...(f.f1099G ?? []).flatMap((g) => g.stateLines.filter((s) => s.state === 'MD').map((s) => s.stateTax)),
      ]);
      const mdEst = sumCents(f.stateReturn.estimatedPayments) + f.stateReturn.priorYearApplied;
      const reqPrior = Math.round((priorMdTax * 110) / 100);
      return mdWithheld + mdEst < reqPrior && reqPrior - mdWithheld > 50_000;
    },
    build: () =>
      yesNo(
        'Do you want Tidy to calculate Maryland underestimated tax interest (Form 502UP) with your return?',
        'If your Maryland withholding and timely estimated payments were less than 90% of 2025 tax and 110% of 2024 tax, Form 502UP figures the interest.',
      ),
    apply: (a, f) => {
      f.stateReturn.computeForm502UP = a === 'yes';
    },
  },
];
