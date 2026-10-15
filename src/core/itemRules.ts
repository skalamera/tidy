import type { Form1099R, Md502RSource, RentalProperty, ScheduleK1, TaxFacts } from '../shared/facts';
import { isIraDistribution, reportedTaxable } from '../engine/federal/retirement';
import type { SectionId } from '../shared/state';
import { parseLines } from '../shared/answers';
import type { QuestionDraft, RuleContext } from './questionRules';
import { wrongYear } from './deriveFacts';

/** A question asked once per item (a rental, a document), keyed `${id}:${item key}`. */
export interface ItemRule {
  id: string;
  sectionId: SectionId;
  /** The items it asks about now, each with a key that stays the same across rebuilds (an id). */
  items(ctx: RuleContext): { key: string; name: string }[];
  build(ctx: RuleContext, item: { key: string; name: string }): QuestionDraft;
  /** Write the answer into the facts being derived. Must be idempotent. */
  apply(answer: string, facts: TaxFacts, key: string): void;
}

export const itemAnswer = (c: RuleContext, ruleId: string, key: string): string | null =>
  c.state.questions.find((q) => q.id === `${ruleId}:${key}`)?.answer ?? null;

const cents = (a: string) => Number.parseInt(a, 10) || 0;
const rentalOf = (f: TaxFacts, key: string): RentalProperty | undefined => (f.rentals ?? []).find((r) => r.id === key);
const nameOf = (r: RentalProperty) => r.address.trim() || 'your rental';
const isRoyalty = (r: RentalProperty) => r.propertyType === 6;

/** Rentals from the 2024 return that were rented out in 2025 (the only kind Tidy reports so far). */
const rentedOut = (c: RuleContext, pred: (r: RentalProperty) => boolean = () => true) =>
  (c.facts.rentals ?? [])
    .filter((r) => itemAnswer(c, 'rental-status', r.id) === 'rented' && pred(r))
    .map((r) => ({ key: r.id, name: nameOf(r) }));

/** Schedule E lines 5–17 and 19 (depreciation, line 18, comes from the property's history). */
export const RENTAL_EXPENSE_LINES = [
  { value: 'advertising', label: 'Advertising (line 5)' },
  { value: 'autoAndTravel', label: 'Auto and travel (line 6)' },
  { value: 'cleaningAndMaintenance', label: 'Cleaning and maintenance (line 7)' },
  { value: 'commissions', label: 'Commissions (line 8)' },
  { value: 'insurance', label: 'Insurance (line 9)' },
  { value: 'legalAndProfessional', label: 'Legal and other professional fees (line 10)' },
  { value: 'managementFees', label: 'Management fees (line 11)' },
  { value: 'mortgageInterest', label: 'Mortgage interest paid to banks (line 12)' },
  { value: 'otherInterest', label: 'Other interest (line 13)' },
  { value: 'repairs', label: 'Repairs (line 14)' },
  { value: 'supplies', label: 'Supplies (line 15)' },
  { value: 'taxes', label: 'Taxes (line 16)' },
  { value: 'utilities', label: 'Utilities (line 17)' },
  { value: 'other', label: 'Other (line 19)' },
] as const;

const k1Of = (f: TaxFacts, key: string): ScheduleK1 | undefined => (f.k1s ?? []).find((k) => k.id === key);
const businessK1s = (c: RuleContext, pred: (k: ScheduleK1) => boolean = () => true) =>
  (c.facts.k1s ?? [])
    .filter((k) => (k.entityType === '1065' || k.entityType === '1120S') && pred(k))
    .map((k) => ({ key: k.id, name: k.entityName || 'the company' }));
const hasBusinessIncome = (k: ScheduleK1) =>
  k.ordinaryBusinessIncome !== 0 || (k.guaranteedPayments ?? 0) !== 0 || (k.section179Deduction ?? 0) !== 0;

export const SCORP_BASIS_LINES = [
  { value: 'beginningStockBasis', label: 'Your stock basis at the start of 2025 (Form 7203, line 1)' },
  { value: 'capitalContributions', label: 'Money or property you put in during 2025' },
  { value: 'beginningDebtBasis', label: 'Loans you made to the company, at the start of 2025 (debt basis)' },
];

const r1099Of = (f: TaxFacts, key: string): Form1099R | undefined => (f.f1099R ?? []).find((r) => r.id === key);
/** Pensions and annuities with a taxable amount (IRAs aren't asked: their kind is on the form). */
const pensions = (c: RuleContext) =>
  (c.facts.f1099R ?? [])
    .filter((r) => !isIraDistribution(r) && reportedTaxable(r) > 0)
    .map((r) => ({ key: r.id, name: r.payerName || 'your pension' }));
const PENSION_KINDS: { value: Md502RSource; label: string }[] = [
  { value: 'qualified_plan', label: 'An employer’s retirement plan: a pension, 401(k), 403(b) or 457(b)' },
  { value: 'public_safety', label: 'A police, fire, rescue or corrections retirement plan' },
  { value: 'military', label: 'Military retirement pay' },
  { value: 'other', label: 'An annuity I bought myself, or something else' },
];

const DAY_LINES = [
  { value: 'fairRentalDays', label: 'Days rented at a fair price' },
  { value: 'personalUseDays', label: 'Days you or your family used it' },
];

export const ITEM_RULES: ItemRule[] = [
  {
    id: 'rental-status',
    sectionId: 'wages',
    items: (c) => (c.facts.rentals ?? []).map((r) => ({ key: r.id, name: nameOf(r) })),
    build: (_c, it) => ({
      kind: 'choice',
      prompt: `What happened with ${it.name} in 2025?`,
      help: 'It was on your 2024 Schedule E.',
      choices: [
        { value: 'rented', label: 'I rented it out' },
        { value: 'sold', label: 'I sold it or gave it away' },
        { value: 'stopped', label: 'I kept it but stopped renting it' },
      ],
      suggested: null,
      blocking: true,
    }),
    apply: () => {}, // read by the flags: only "rented" is supported so far
  },
  {
    id: 'rental-income',
    sectionId: 'wages',
    items: (c) => rentedOut(c),
    build: (c, it) => {
      const royalty = isRoyalty(rentalOf(c.facts, it.key)!);
      return {
        kind: 'money',
        prompt: royalty
          ? `How much in royalties did you receive from ${it.name} in 2025?`
          : `How much rent did you receive for ${it.name} in 2025?`,
        help: royalty
          ? 'Use your 1099-MISC box 2 or your own records.'
          : 'All rent for the year, including advance rent and any security deposit you kept. Enter 0 if none.',
        choices: null,
        suggested: null,
        blocking: true,
      };
    },
    apply: (a, f, key) => {
      const r = rentalOf(f, key);
      if (!r) return;
      if (isRoyalty(r)) r.royaltiesReceived = cents(a);
      else r.rentsReceived = cents(a);
    },
  },
  {
    id: 'rental-expenses',
    sectionId: 'wages',
    items: (c) => rentedOut(c),
    build: (_c, it) => ({
      kind: 'lines',
      prompt: `What did you spend on ${it.name} in 2025?`,
      help: 'Leave a line blank if it’s 0. Include mortgage interest and property tax for this property here, unless you uploaded its Form 1098 or tax bill and told Tidy it’s for this rental. Depreciation is worked out from your 2024 return.',
      choices: [...RENTAL_EXPENSE_LINES],
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = rentalOf(f, key);
      const lines = parseLines(a, RENTAL_EXPENSE_LINES);
      if (!r || !lines) return;
      const expenses = { ...r.expenses };
      for (const [line, amount] of Object.entries(lines)) {
        const k = line as keyof typeof expenses & (typeof RENTAL_EXPENSE_LINES)[number]['value'];
        expenses[k] = ((expenses[k] as number | undefined) ?? 0) + amount;
      }
      r.expenses = expenses;
    },
  },
  {
    id: 'rental-full-year',
    sectionId: 'wages',
    items: (c) => rentedOut(c, (r) => !isRoyalty(r)),
    build: (_c, it) => ({
      kind: 'yes_no',
      prompt: `Was ${it.name} rented at a fair price for all of 2025, with no personal use by you or your family?`,
      help: 'Days it sat empty while you were trying to rent it count as rented.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = rentalOf(f, key);
      if (r && a === 'yes') Object.assign(r, { fairRentalDays: 365, personalUseDays: 0 });
    },
  },
  {
    id: 'rental-days',
    sectionId: 'wages',
    items: (c) => rentedOut(c, (r) => !isRoyalty(r)).filter((it) => itemAnswer(c, 'rental-full-year', it.key) === 'no'),
    build: (_c, it) => ({
      kind: 'counts',
      prompt: `How many days in 2025 was ${it.name} rented, and how many did you or your family use it?`,
      help: 'Personal use includes days a relative stayed there for less than a fair rent.',
      choices: DAY_LINES,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = rentalOf(f, key);
      const days = parseLines(a, DAY_LINES, 'counts');
      if (r && days) Object.assign(r, { fairRentalDays: days.fairRentalDays ?? 0, personalUseDays: days.personalUseDays ?? 0 });
    },
  },
  {
    id: 'rental-participation',
    sectionId: 'wages',
    items: (c) => rentedOut(c, (r) => !isRoyalty(r)),
    build: (_c, it) => ({
      kind: 'yes_no',
      prompt: `Did you or your spouse take part in managing ${it.name}, like approving tenants, setting the rent or approving repairs?`,
      help: 'That is “active participation”. It lets up to $25,000 of a rental loss count against other income (Form 8582).',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = rentalOf(f, key);
      if (r) r.activeParticipation = a === 'yes';
    },
  },
  {
    id: 'rental-qbi',
    sectionId: 'wages',
    items: (c) => rentedOut(c, (r) => !isRoyalty(r)),
    build: (_c, it) => ({
      kind: 'yes_no',
      prompt: `Do you treat renting ${it.name} as a business for the qualified business income deduction?`,
      help: 'Usually only if you (or people you pay) spend 250 hours or more a year on the rental and keep records of the time. Most owners of one or two rentals answer No.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = rentalOf(f, key);
      if (r) r.qualifiesForQbi = a === 'yes';
    },
  },
  {
    id: 'k1-participation',
    sectionId: 'wages',
    items: (c) => businessK1s(c, hasBusinessIncome),
    build: (_c, it) => ({
      kind: 'yes_no',
      prompt: `Did you work in the business of ${it.name} for more than 500 hours in 2025, or take part in it regularly and substantially?`,
      help: 'That is “material participation”. It makes the K-1 business income or loss nonpassive on Schedule E. Answer No if you’re only an investor.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const k = k1Of(f, key);
      if (k) k.isMaterialParticipation = a === 'yes';
    },
  },
  {
    id: 'k1-sstb',
    sectionId: 'wages',
    items: (c) => businessK1s(c, (k) => (k.qbiAmount ?? 0) !== 0 || k.ordinaryBusinessIncome !== 0),
    build: (_c, it) => ({
      kind: 'yes_no',
      prompt: `Is ${it.name} a “specified service” business?`,
      help: 'Health, law, accounting, consulting, financial or brokerage services, performing arts, athletics, or a business whose main asset is its people’s skill. The K-1’s Statement A for section 199A usually says. It limits the qualified business income deduction at higher incomes.',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const k = k1Of(f, key);
      if (k) k.isSstb = a === 'yes';
    },
  },
  {
    id: 'k1-basis',
    sectionId: 'wages',
    items: (c) => businessK1s(c, (k) => k.entityType === '1120S' && Boolean(k.sCorpBasis)),
    build: (_c, it) => ({
      kind: 'lines',
      prompt: `What was your basis in ${it.name}?`,
      help: 'An S corporation loss or distribution is limited by your stock and debt basis (Form 7203). Your 2024 Form 7203 shows the basis you ended the year with. Leave a line blank if it’s 0.',
      choices: SCORP_BASIS_LINES,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const k = k1Of(f, key);
      const v = parseLines(a, SCORP_BASIS_LINES);
      if (!k?.sCorpBasis || !v) return;
      k.sCorpBasis.beginningStockBasis = Math.max(0, v.beginningStockBasis ?? 0);
      k.sCorpBasis.capitalContributions = Math.max(0, v.capitalContributions ?? 0);
      k.sCorpBasis.beginningDebtBasis = Math.max(0, v.beginningDebtBasis ?? 0);
      k.sCorpBasis.beginningLoanBalance = Math.max(0, v.beginningDebtBasis ?? 0);
    },
  },
  {
    id: 'pension-kind',
    sectionId: 'wages',
    items: (c) => pensions(c),
    build: (_c, it) => ({
      kind: 'choice',
      prompt: `What kind of plan paid your 1099-R from ${it.name}?`,
      help: 'Maryland excludes part of the income from employer retirement plans for people 65 or older (or disabled), but not from annuities you bought yourself.',
      choices: PENSION_KINDS,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = r1099Of(f, key);
      if (r && PENSION_KINDS.some((k) => k.value === a)) r.mdSource = a as Md502RSource;
    },
  },
  {
    id: 'pension-pso',
    sectionId: 'wages',
    items: (c) => pensions(c).filter((it) => itemAnswer(c, 'pension-kind', it.key) === 'public_safety'),
    build: (_c, it) => ({
      kind: 'money',
      prompt: `How much did ${it.name} pay from your pension for health or long-term care insurance in 2025? Enter 0 if none.`,
      help: 'Retired police officers, firefighters, chaplains and rescue or ambulance crew members leave up to $3,000 of these premiums out of income (Form 1040 line 5b, marked PSO).',
      choices: null,
      suggested: null,
      blocking: true,
    }),
    apply: (a, f, key) => {
      const r = r1099Of(f, key);
      if (r) r.psoAmount = Math.max(0, cents(a));
    },
  },
  {
    id: 'home-or-rental',
    sectionId: 'deductions',
    items: (c) =>
      rentedOut(c).length === 0
        ? []
        : c.state.documents
            .filter((d) => d.status === 'done' && !d.supersededBy && wrongYear(d) === null)
            .flatMap((d) =>
              d.extractions.flatMap((x, i) =>
                x.form === 'f1098' || (x.form === 'payment' && x.data.kind === 'property_tax')
                  ? [
                      {
                        key: `${d.id}-${i}`,
                        name: `${x.form === 'f1098' ? 'Form 1098' : 'property tax bill'} from ${(x.form === 'f1098' ? x.data.lenderName : x.data.payee) || d.fileName}`,
                      },
                    ]
                  : [],
              ),
            ),
    build: (c, it) => ({
      kind: 'choice',
      prompt: `Is the ${it.name} for your home or for a rental?`,
      help: 'A rental’s mortgage interest and property tax go on Schedule E instead of Schedule A.',
      choices: [{ value: 'home', label: 'My home' }, ...rentedOut(c).map((r) => ({ value: r.key, label: r.name }))],
      suggested: null,
      blocking: true,
    }),
    apply: () => {}, // deriveFacts routes the amounts while it reads the document
  },
];

/** The item rule a question id belongs to, and the item's key. */
export function itemRuleOf(questionId: string): { rule: ItemRule; key: string } | null {
  const colon = questionId.indexOf(':');
  if (colon < 0) return null;
  const rule = ITEM_RULES.find((r) => r.id === questionId.slice(0, colon));
  return rule ? { rule, key: questionId.slice(colon + 1) } : null;
}
