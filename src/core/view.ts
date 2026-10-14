import { formatUsd, type Cents } from '../engine/money';
import { computeFederal, type FederalResult } from '../engine/federal/form1040';
import type { Ledger } from '../engine/ledger';
import { computeStateReturn, stateTotals, type StateResult } from '../engine/state';
import type { AiProvider } from '../shared/ai';
import { maskSsn } from '../shared/answers';
import type { Evidence, TaxFacts } from '../shared/facts';
import { NO_CHAT, type ChatView } from '../shared/chat';
import type { AppState, DocumentRecord, Flag, Proposal, Question, SectionId } from '../shared/state';
import { deriveFacts, latestPriorYear } from './deriveFacts';
import { isReceived, missingExpected } from './expected';
import { deriveFlags } from './flags';
import { nextAction, type NextAction } from './nextAction';
import { STATUS_LABEL } from './questionRules';
import { SECTIONS, sectionStates, type SectionState } from './sections';

export interface Row {
  label: string;
  value: string;
  cents: Cents | null;
  /** Ledger line behind this number (click → "how we got this"). */
  lineId: string | null;
  /** How the line is computed, e.g. "Line 9 − line 10". */
  formula: string | null;
  /** Document location behind this number (click → open the page). */
  source: Evidence | null;
  note: string | null;
}
export interface Card {
  id: string;
  title: string;
  subtitle: string | null;
  rows: Row[];
}
export interface DocView {
  id: string;
  fileName: string;
  status: DocumentRecord['status'];
  kind: string;
  issuer: string | null;
  pageCount: number;
  error: string | null;
  superseded: boolean;
}
export interface AppView {
  now: NextAction;
  sections: SectionState[];
  progress: { approved: number; total: number };
  details: Record<SectionId, Card[]>;
  questions: Question[];
  flags: Flag[];
  documents: DocView[];
  summary: {
    agi: Cents;
    taxableIncome: Cents;
    totalTax: Cents;
    payments: Cents;
    refund: Cents;
    owed: Cents;
    itemizing: boolean;
    state: { code: 'MD'; totalTax: Cents; refund: Cents; owed: Cents } | null;
  };
  /** Suggestions made in the open chat, in any state, so its cards show how each one ended. */
  proposals: Proposal[];
  chat: ChatView;
  /** The AI that reads documents and answers chat; null until the user connects one. */
  aiProvider: AiProvider | null;
  canExport: boolean;
  /** Working out the return failed, so steps are paused and totals hidden (see problemView). */
  problem: boolean;
}

const KIND: Record<string, string> = {
  prior_year_federal_return: 'Last year’s return',
  w2: 'W-2',
  f1099_int: '1099-INT',
  f1099_div: '1099-DIV',
  f1099_b: '1099-B',
  f1099_r: '1099-R',
  f1099_nec: '1099-NEC',
  ssa_1099: 'SSA-1099',
  k1_1065: 'Schedule K-1 (1065)',
  k1_1120s: 'Schedule K-1 (1120-S)',
  k1_1041: 'Schedule K-1 (1041)',
  f1099_composite: 'Brokerage 1099',
  f1098: 'Mortgage interest (1098)',
  property_tax_bill: 'Property tax',
  charity_receipt: 'Donation receipt',
  estimated_payment_record: 'Estimated payment',
};
const FORM_NAME: Record<string, string> = {
  w2: 'W-2',
  f1099_int: '1099-INT',
  f1099_div: '1099-DIV',
  f1099_r: '1099-R',
  f1099_nec: '1099-NEC',
  ssa_1099: 'SSA-1099',
  f1099_b: '1099-B',
  k1: 'K-1',
  f1098: '1098',
};

const FORM_NAME_BY_ID: Record<string, string> = {
  f1040: 'Form 1040',
  sch1: 'Schedule 1',
  sch1A: 'Schedule 1-A',
  sch2: 'Schedule 2',
  sch3: 'Schedule 3',
  f2210: 'Form 2210',
  schA: 'Schedule A',
  schB: 'Schedule B',
  schC: 'Schedule C',
  schD: 'Schedule D',
  f8949: 'Form 8949',
  schE: 'Schedule E',
  schSE: 'Schedule SE',
  f4797: 'Form 4797',
  f8995: 'Form 8995',
  f8995a: 'Form 8995-A',
  f8959: 'Form 8959',
  f8960: 'Form 8960',
  f8582: 'Form 8582',
  f8829: 'Form 8829',
  f4562: 'Form 4562',
  f7203: 'Form 7203',
  f7206: 'Form 7206',
  md502: 'Maryland Form 502',
  md502r: 'Maryland Form 502R',
  md502su: 'Maryland Form 502SU',
  md502cr: 'Maryland Form 502CR',
  md502cg: 'Maryland Form 502CG',
  md500dm: 'Maryland Form 500DM',
  md502up: 'Maryland Form 502UP',
};

const money = (label: string, cents: Cents, extra: Partial<Row> = {}): Row => ({
  label,
  value: formatUsd(cents),
  cents,
  lineId: null,
  formula: null,
  source: null,
  note: null,
  ...extra,
});
const text = (label: string, value: string, note: string | null = null): Row => ({
  label,
  value,
  cents: null,
  lineId: null,
  formula: null,
  source: null,
  note,
});
const fromLedger = (l: Ledger, id: string, label: string, note: string | null = null): Row =>
  money(label, l.get(id), { lineId: id, formula: l.line(id)?.formula ?? null, note });
const line = (r: FederalResult, id: string, label: string, note: string | null = null): Row => fromLedger(r.ledger, id, label, note);

function stateCards(s: StateResult | null): Card[] {
  if (!s)
    return [{ id: 'state-none', title: 'No state return yet', subtitle: 'Answer “Where did you live?” in About you first.', rows: [] }];
  const l = s.md.ledger;
  return [
    {
      id: 'md502',
      title: 'Your 2025 Maryland return (Form 502)',
      subtitle: null,
      rows: [
        fromLedger(l, 'md502.1', 'Federal adjusted gross income'),
        ...(l.get('md502.5') > 0 ? [fromLedger(l, 'md502.5', 'Decoupling addition modification (Form 500DM)')] : []),
        ...(l.get('md502.10a') > 0 ? [fromLedger(l, 'md502.10a', 'Pension exclusion (Worksheet 13A)')] : []),
        ...(l.get('md502.11') > 0 ? [fromLedger(l, 'md502.11', 'Social Security subtraction')] : []),
        ...(l.get('md502su.bb') > 0 ? [fromLedger(l, 'md502su.bb', 'Decoupling subtraction modification (Form 500DM)')] : []),
        fromLedger(l, 'md502.16', 'Maryland adjusted gross income'),
        fromLedger(l, 'md502.17', s.md.itemizing ? 'Itemized deductions' : 'Standard deduction'),
        fromLedger(l, 'md502.19', 'Exemptions'),
        fromLedger(l, 'md502.20', 'Taxable net income'),
        fromLedger(l, 'md502.21', 'Maryland tax'),
        ...(l.get('md502.21b') > 0 ? [fromLedger(l, 'md502.21b', '2% tax on capital gains')] : []),
        ...(l.get('md502.24') > 0 ? [fromLedger(l, 'md502.24', 'Senior tax credit (Form 502CR)')] : []),
        fromLedger(l, 'md502.28', 'Local (county) tax'),
        fromLedger(l, 'md502.34', 'Total tax'),
        fromLedger(l, 'md502.46', 'Total payments'),
        ...(l.get('md502.51') > 0 ? [fromLedger(l, 'md502.51', 'Underpayment interest (Form 502UP)')] : []),
        s.md.refund > 0 ? fromLedger(l, 'md502.48', 'Refund') : fromLedger(l, 'md502.52', 'Amount you owe'),
      ],
    },
  ];
}
const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No');

function details(state: AppState, f: TaxFacts, r: FederalResult, s: StateResult | null, flags: Flag[]): Record<SectionId, Card[]> {
  const people: Card[] = [
    {
      id: 'you',
      title: 'You',
      subtitle: null,
      rows: [
        text('Name', `${f.taxpayer.firstName} ${f.taxpayer.lastName}`.trim() || '—'),
        text('Social Security number', maskSsn(f.taxpayer.ssn)),
      ],
    },
    ...(f.spouse
      ? [
          {
            id: 'spouse',
            title: 'Spouse',
            subtitle: null,
            rows: [text('Name', `${f.spouse.firstName} ${f.spouse.lastName}`), text('Social Security number', maskSsn(f.spouse.ssn))],
          },
        ]
      : []),
    {
      id: 'filing',
      title: 'Filing',
      subtitle: null,
      rows: [
        text('Filing status', STATUS_LABEL[f.filingStatus]),
        text(
          'Home address',
          [f.address.street, f.address.apt, f.address.city, f.address.state, f.address.zip].filter(Boolean).join(', ') || '—',
        ),
        text('State return', f.residency.state === 'MD' ? 'Maryland' : '—'),
        text('Crypto or digital assets in 2025', yesNo(f.digitalAssets)),
      ],
    },
  ];

  const docs: Card[] = [
    {
      id: 'docs',
      title: 'Documents we read',
      subtitle: null,
      rows: state.documents.map((d) =>
        text(
          `${KIND[d.docType ?? ''] ?? 'Document'} · ${d.classification?.issuerName ?? d.fileName}`,
          {
            queued: 'Waiting',
            reading: 'Reading…',
            done: d.supersededBy ? 'Replaced by corrected copy' : 'Read ✓',
            unsupported: 'Not supported yet',
            failed: 'Couldn’t read',
            duplicate: 'Duplicate',
          }[d.status],
        ),
      ),
    },
    ...(state.expected.length
      ? [
          {
            id: 'expected',
            title: 'Expected from last year',
            subtitle: null,
            rows: state.expected.map((e) =>
              text(
                `${FORM_NAME[e.form] ?? e.form} · ${e.name}`,
                isReceived(e, state.documents) ? 'Received ✓' : e.dismissed ? 'Not this year' : 'Missing',
              ),
            ),
          },
        ]
      : []),
  ];

  const wages: Card[] = [
    ...f.w2s.map((w) => ({
      id: w.id,
      title: w.employerName,
      subtitle: w.owner === 'spouse' ? 'Spouse’s W-2' : 'Your W-2',
      rows: [
        money('Wages (box 1)', w.box1Wages, { source: w.evidence.box1Wages ?? null }),
        money('Federal tax withheld (box 2)', w.box2FedWithheld, { source: w.evidence.box2FedWithheld ?? null }),
        money('Social security tax withheld (box 4)', w.box4SsWithheld),
        money('Medicare wages (box 5)', w.box5MedicareWages),
        ...w.stateLines.map((s) => money(`${s.state} tax withheld`, s.stateTax)),
        ...w.localLines.map((l) => money(`${l.locality} tax withheld`, l.localTax)),
      ],
    })),
    ...(f.f1099R ?? []).map((dist) => ({
      id: dist.id,
      title: dist.payerName,
      subtitle: `${dist.owner === 'spouse' ? 'Spouse’s' : 'Your'} 1099-R · ${dist.iraSepSimple ? 'IRA / SEP / SIMPLE' : 'Pension or annuity'} (code ${dist.box7Codes || '7'})`,
      rows: [
        money('Gross distribution (box 1)', dist.box1GrossDistribution, { source: dist.evidence.box1GrossDistribution ?? null }),
        money('Taxable amount (box 2a)', dist.box2aTaxableAmount, { source: dist.evidence.box2aTaxableAmount ?? null }),
        ...(dist.qcdAmount ? [money('Qualified charitable distribution (QCD)', dist.qcdAmount)] : []),
        ...(dist.rolloverAmount ? [money('Rolled over', dist.rolloverAmount)] : []),
        money('Federal tax withheld (box 4)', dist.box4FedWithheld, { source: dist.evidence.box4FedWithheld ?? null }),
        ...dist.stateLines.map((s) => money(`${s.state} tax withheld`, s.stateTax)),
      ],
    })),
    ...(f.ssa1099 ?? []).map((ssa) => ({
      id: ssa.id,
      title: 'Social Security (SSA-1099)',
      subtitle: ssa.owner === 'spouse' ? 'Spouse’s benefits' : 'Your benefits',
      rows: [
        money('Net benefits for 2025 (box 5)', ssa.box5NetBenefits, { source: ssa.evidence.box5NetBenefits ?? null }),
        money('Federal tax withheld (box 6)', ssa.box6FedWithheld, { source: ssa.evidence.box6FedWithheld ?? null }),
      ],
    })),
    ...(f.f1099Nec ?? []).map((nec) => ({
      id: nec.id,
      title: nec.payerName,
      subtitle: `${nec.owner === 'spouse' ? 'Spouse’s' : 'Your'} 1099-NEC`,
      rows: [
        money('Nonemployee compensation (box 1)', nec.box1NonemployeeCompensation, {
          source: nec.evidence.box1NonemployeeCompensation ?? null,
        }),
        ...(nec.box4FedWithheld > 0
          ? [money('Federal tax withheld (box 4)', nec.box4FedWithheld, { source: nec.evidence.box4FedWithheld ?? null })]
          : []),
      ],
    })),
    ...(r.business.needsScheduleC
      ? [
          {
            id: 'sch-c',
            title: r.business.activeBusiness?.businessName || r.business.activeBusiness?.principalBusiness || 'Schedule C Business',
            subtitle: 'Schedule C · Profit or Loss From Business',
            rows: [
              line(r, 'schC.7', 'Gross business income'),
              line(r, 'schC.28', 'Operating expenses'),
              ...(r.ledger.get('schC.30') > 0 ? [line(r, 'schC.30', 'Business use of home')] : []),
              line(r, 'schC.31', 'Net profit or (loss)'),
              ...(r.business.needsForm4797 ? [line(r, 'sch1.4', 'Sale or abandonment of business assets (Form 4797)')] : []),
              ...(r.business.seTax > 0
                ? [line(r, 'schSE.12', 'Self-employment tax (Schedule SE)'), line(r, 'sch1.15', 'Deductible half of self-employment tax')]
                : []),
              ...(r.business.sepDeduction > 0 ? [line(r, 'sch1.16', 'Self-employed SEP / retirement plan deduction')] : []),
              ...(r.business.seHealthInsuranceDeduction > 0
                ? [line(r, 'sch1.17', 'Self-employed health insurance deduction (Form 7206)')]
                : []),
            ],
          },
        ]
      : []),
    ...(r.scheduleE.needsScheduleE
      ? [
          {
            id: 'sch-e',
            title: 'Rentals & Pass-Throughs (Schedule E)',
            subtitle: 'Schedule E · Supplemental Income and Loss',
            rows: [
              ...((f.rentals ?? []).length > 0 ? [line(r, 'schE.26', 'Net rental real estate and royalty income or (loss)')] : []),
              ...((f.k1s ?? []).some((k) => k.entityType === '1065' || k.entityType === '1120S')
                ? [line(r, 'schE.32', 'Net partnership and S corporation income or (loss)')]
                : []),
              ...((f.k1s ?? []).some((k) => k.entityType === '1041') ? [line(r, 'schE.37', 'Net estate and trust income or (loss)')] : []),
              line(r, 'sch1.5', 'Total Schedule E income or (loss) (Schedule 1, line 5)'),
              ...(r.scheduleE.passiveLossCarryoverTo2026 > 0
                ? [money('Unallowed passive loss carryover to 2026 (Form 8582)', r.scheduleE.passiveLossCarryoverTo2026)]
                : []),
            ],
          },
        ]
      : []),
    {
      id: 'wage-totals',
      title: 'Totals',
      subtitle: null,
      rows: [
        line(r, 'f1040.1z', 'Total wages'),
        ...(r.business.needsScheduleC ? [line(r, 'sch1.3', 'Net business profit or (loss) (Schedule C)')] : []),
        ...(r.scheduleE.needsScheduleE ? [line(r, 'sch1.5', 'Net rental & K-1 income or (loss) (Schedule E)')] : []),
        ...(r.ledger.get('f1040.4a') > 0 ? [line(r, 'f1040.4b', 'Taxable IRA distributions')] : []),
        ...(r.ledger.get('f1040.5a') > 0 ? [line(r, 'f1040.5b', 'Taxable pensions and annuities')] : []),
        ...(r.ledger.get('f1040.6a') > 0 ? [line(r, 'f1040.6b', 'Taxable Social Security benefits')] : []),
        line(r, 'f1040.25a', 'Federal tax withheld from W-2s'),
      ],
    },
  ];

  const investments: Card[] = [
    ...f.f1099Int.map((x) => ({
      id: x.id,
      title: x.payerName,
      subtitle: '1099-INT',
      rows: [
        money('Interest (box 1)', x.box1Interest, { source: x.evidence.box1Interest ?? null }),
        money('U.S. Treasury interest (box 3)', x.box3UsTreasuryInterest),
        money('Tax-exempt interest (box 8)', x.box8TaxExemptInterest),
      ],
    })),
    ...f.f1099Div.map((x) => ({
      id: x.id,
      title: x.payerName,
      subtitle: '1099-DIV',
      rows: [
        money('Ordinary dividends (box 1a)', x.box1aOrdinaryDividends, { source: x.evidence.box1aOrdinaryDividends ?? null }),
        money('Qualified dividends (box 1b)', x.box1bQualifiedDividends),
        money('Capital gain distributions (box 2a)', x.box2aCapitalGainDistributions),
        ...(x.box2bUnrecaptured1250Gain > 0 ? [money('Unrecaptured Section 1250 gain (box 2b)', x.box2bUnrecaptured1250Gain)] : []),
        ...(x.box2d28RateGain > 0 ? [money('28% rate gain (box 2d)', x.box2d28RateGain)] : []),
        ...(x.box5Section199aDividends > 0 ? [money('Section 199A REIT dividends (box 5)', x.box5Section199aDividends)] : []),
      ],
    })),
    ...(f.f1099B ?? []).map((b) => {
      const proceeds = b.lots.reduce((s, l) => s + l.proceeds, 0);
      const basis = b.lots.reduce((s, l) => s + l.costBasis, 0);
      const wash = b.lots.reduce((s, l) => s + l.washSaleDisallowed, 0);
      const discount = b.lots.reduce((s, l) => s + l.marketDiscount, 0);
      const net = proceeds - basis + wash - discount;
      return {
        id: b.id,
        title: b.payerName,
        subtitle: `1099-B · ${b.lots.length} ${b.lots.length === 1 ? 'sale' : 'sales'}`,
        rows: [
          money('Total proceeds (box 1d)', proceeds),
          money('Total cost basis (box 1e)', basis),
          ...(wash > 0 ? [money('Wash sale loss disallowed (box 1g)', wash)] : []),
          ...(discount > 0 ? [money('Accrued market discount (box 1f)', discount)] : []),
          money('Net capital gain or (loss)', net),
          ...(b.box4FedWithheld > 0
            ? [money('Federal tax withheld (box 4)', b.box4FedWithheld, { source: b.evidence.box4FedWithheld ?? null })]
            : []),
        ],
      };
    }),
    {
      id: 'inv-totals',
      title: 'Totals',
      subtitle: null,
      rows: [
        line(r, 'f1040.2b', 'Taxable interest'),
        line(r, 'f1040.3b', 'Ordinary dividends'),
        line(r, 'f1040.3a', 'Qualified dividends', 'Taxed at lower capital gains rates'),
        ...((f.f1099B ?? []).length > 0 || (f.carryovers?.capitalLossShortTerm ?? 0) > 0 || (f.carryovers?.capitalLossLongTerm ?? 0) > 0
          ? [line(r, 'schD.7', 'Net short-term capital gain or (loss)'), line(r, 'schD.15', 'Net long-term capital gain or (loss)')]
          : []),
        line(r, 'f1040.7a', 'Capital gain or (loss) on Form 1040'),
        ...(r.capitalLossCarryoverTo2026.shortTerm > 0 || r.capitalLossCarryoverTo2026.longTerm > 0
          ? [
              money('Capital loss carryover to 2026', r.capitalLossCarryoverTo2026.shortTerm + r.capitalLossCarryoverTo2026.longTerm, {
                note: `Short-term: ${formatUsd(r.capitalLossCarryoverTo2026.shortTerm)} · Long-term: ${formatUsd(r.capitalLossCarryoverTo2026.longTerm)}`,
              }),
            ]
          : []),
      ],
    },
  ];

  const capped = r.ledger.get('schA.5d') > r.ledger.get('schA.5e');
  const deductions: Card[] = [
    {
      id: 'choice',
      title: r.itemizing ? 'You’re itemizing' : 'You’re taking the standard deduction',
      subtitle: 'We picked whichever is bigger.',
      rows: [
        line(r, 'f1040.12e', 'Deduction used'),
        line(r, 'schA.17', 'Itemized total'),
        ...(r.ledger.get('f1040.13a') > 0 ? [line(r, 'f1040.13a', 'Qualified business / REIT dividend deduction (Form 8995)')] : []),
        ...(r.ledger.get('f1040.13b') > 0 ? [line(r, 'f1040.13b', 'Enhanced senior deduction (Schedule 1-A)')] : []),
      ],
    },
    {
      id: 'itemized',
      title: 'Itemized details',
      subtitle: null,
      rows: [
        line(r, 'schA.4', 'Medical (above 7.5% of income)'),
        line(r, 'schA.5d', 'State and local taxes paid'),
        line(r, 'schA.5e', 'State and local taxes you can deduct', capped ? 'Limited by the SALT cap' : null),
        line(r, 'schA.8a', 'Mortgage interest'),
        line(r, 'schA.14', 'Gifts to charity'),
      ],
    },
  ];

  const payments: Card[] = [
    {
      id: 'paid',
      title: 'Already paid for 2025',
      subtitle: null,
      rows: [
        line(r, 'f1040.25d', 'Withheld from paychecks and 1099s'),
        ...f.payments.federalEstimated.map((c, i) => money(`Estimated payment ${i + 1}`, c)),
        money('Applied from your 2024 refund', f.payments.federalPriorYearApplied),
        money('Paid with extension', f.payments.federalExtensionPayment),
        line(r, 'f1040.33', 'Total payments'),
      ],
    },
  ];

  const total = r.ledger.get('f1040.9');
  const rate = total > 0 ? ((r.totalTax / total) * 100).toFixed(1) : '0.0';
  const summary: Card[] = [
    {
      id: 'f1040',
      title: 'Your 2025 federal return',
      subtitle: `Effective tax rate: ${rate}% of total income`,
      rows: [
        line(r, 'f1040.9', 'Total income'),
        line(r, 'f1040.11a', 'Adjusted gross income'),
        line(r, 'f1040.14', 'Deductions'),
        line(r, 'f1040.15', 'Taxable income'),
        line(r, 'f1040.16', 'Income tax'),
        line(r, 'sch2.11', 'Additional Medicare Tax'),
        line(r, 'sch2.12', 'Net investment income tax'),
        line(r, 'f1040.24', 'Total tax'),
        line(r, 'f1040.33', 'Total payments'),
        ...(r.ledger.get('f1040.38') > 0 ? [line(r, 'f1040.38', 'Estimated tax penalty (Form 2210)')] : []),
        r.refund > 0 ? line(r, 'f1040.34', 'Refund') : line(r, 'f1040.37', 'Amount you owe'),
      ],
    },
  ];

  const review: Card[] = [
    {
      id: 'flags',
      title: flags.length ? 'Things to look at' : 'Nothing to fix',
      subtitle: null,
      rows: flags.map((x) => text(x.title, x.severity === 'blocker' ? 'Must fix' : 'Heads-up', x.detail)),
    },
  ];
  const stateForms = s ? s.md.forms : [];
  const file: Card[] = [
    {
      id: 'forms',
      title: 'Forms in your package',
      subtitle: null,
      rows: [...r.forms, ...stateForms].map((id) => text(FORM_NAME_BY_ID[id] ?? id, 'Included')),
    },
  ];

  return {
    profile: people,
    documents: docs,
    wages,
    investments,
    deductions,
    payments,
    federal_summary: summary,
    state_summary: stateCards(s),
    final_review: review,
    file,
  };
}

export interface ViewContext {
  aiProvider: AiProvider | null;
  /** Chats are kept apart from the return; leaving this out means none. */
  chat?: ChatView;
}

const docViews = (state: AppState): DocView[] =>
  state.documents.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    status: d.status,
    kind: KIND[d.docType ?? ''] ?? 'Document',
    issuer: d.classification?.issuerName ?? null,
    pageCount: d.pageCount,
    error: d.error,
    superseded: d.supersededBy !== null,
  }));

const chatProposals = (state: AppState, chat: ChatView): Proposal[] => {
  const shown = new Set(chat.messages.flatMap((m) => m.proposalIds));
  return state.proposals.filter((p) => shown.has(p.id));
};

/** What the screen shows when working out the return throws (a bug). Everything that doesn't need the math keeps
 *  working, so the user can undo what they just did; no step can be approved and nothing can be printed. */
export function problemView(state: AppState, ctx: ViewContext): AppView {
  const chat = ctx.chat ?? NO_CHAT;
  return {
    now: {
      title: 'Tidy hit a snag',
      detail:
        'Something unexpected stopped Tidy from working out your return. Your documents and answers are saved. If you just added a file or changed an answer, try undoing it.',
      cta: { label: 'Open documents', intent: { type: 'open_section', sectionId: 'documents' } },
      tone: 'fix',
    },
    sections: SECTIONS.map((def) => ({
      id: def.id,
      title: def.title,
      icon: def.icon,
      blurb: def.blurb,
      status: 'paused',
      openQuestions: state.questions.filter((q) => q.sectionId === def.id && q.blocking && q.answer === null).length,
      hash: '',
    })),
    progress: { approved: Object.keys(state.approvals).length, total: SECTIONS.length },
    details: Object.fromEntries(SECTIONS.map((s) => [s.id, []])) as unknown as Record<SectionId, Card[]>,
    questions: state.questions,
    flags: [],
    documents: docViews(state),
    summary: { agi: 0, taxableIncome: 0, totalTax: 0, payments: 0, refund: 0, owed: 0, itemizing: false, state: null },
    proposals: chatProposals(state, chat),
    chat,
    aiProvider: ctx.aiProvider,
    canExport: false,
    problem: true,
  };
}

/** Everything the renderer draws, computed in main from the stored state. Pure. */
export function buildView(state: AppState, ctx: ViewContext): AppView {
  const facts = deriveFacts(state);
  const result = computeFederal(facts);
  const stateResult = computeStateReturn(facts, result);
  const sections = sectionStates(state, facts, result);
  const flags = deriveFlags(state, facts, result);
  const busyDocs = state.documents.filter((d) => d.status === 'queued' || d.status === 'reading').length;
  const now = nextAction({
    welcomed: state.onboarding.welcomed,
    hasApiKey: ctx.aiProvider !== null,
    hasPriorYear: latestPriorYear(state) !== null,
    priorYearSkipped: state.onboarding.priorYearSkipped,
    busyDocs,
    sections,
    missingDocs: missingExpected(state).length,
  });
  return {
    now,
    sections,
    progress: { approved: sections.filter((s) => s.status === 'approved').length, total: SECTIONS.length },
    details: details(state, facts, result, stateResult, flags),
    questions: state.questions,
    flags,
    documents: docViews(state),
    summary: {
      agi: result.agi,
      taxableIncome: result.taxableIncome,
      totalTax: result.totalTax,
      payments: result.totalPayments,
      refund: result.refund,
      owed: result.amountOwed,
      itemizing: result.itemizing,
      state: stateResult
        ? {
            code: stateResult.state,
            totalTax: stateTotals(stateResult).totalTax,
            refund: stateTotals(stateResult).refund,
            owed: stateTotals(stateResult).amountOwed,
          }
        : null,
    },
    proposals: chatProposals(state, ctx.chat ?? NO_CHAT),
    chat: ctx.chat ?? NO_CHAT,
    aiProvider: ctx.aiProvider,
    canExport: sections.every((s) => s.id === 'file' || s.status === 'approved') && !flags.some((x) => x.severity === 'blocker'),
    problem: false,
  };
}
