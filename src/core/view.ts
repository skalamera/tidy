import { formatUsd, type Cents } from '../engine/money';
import { computeFederal, type FederalResult } from '../engine/federal/form1040';
import type { Ledger } from '../engine/ledger';
import { computeStateReturn, stateTotals, type StateResult } from '../engine/state';
import type { Evidence, TaxFacts } from '../shared/facts';
import type { AppState, ChatMessage, DocumentRecord, Flag, Proposal, Question, SectionId } from '../shared/state';
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
  proposals: Proposal[];
  chat: ChatMessage[];
  hasApiKey: boolean;
  canExport: boolean;
}

const KIND: Record<string, string> = {
  prior_year_federal_return: 'Last year’s return',
  w2: 'W-2',
  f1099_int: '1099-INT',
  f1099_div: '1099-DIV',
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
  f1099_b: '1099-B',
  k1: 'K-1',
  f1098: '1098',
};

const FORM_NAME_BY_ID: Record<string, string> = {
  f1040: 'Form 1040',
  sch2: 'Schedule 2',
  sch3: 'Schedule 3',
  schA: 'Schedule A',
  schB: 'Schedule B',
  f8959: 'Form 8959',
  f8960: 'Form 8960',
  md502: 'Maryland Form 502',
  md502su: 'Maryland Form 502SU',
  md502cg: 'Maryland Form 502CG',
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
        fromLedger(l, 'md502.16', 'Maryland adjusted gross income'),
        fromLedger(l, 'md502.17', s.md.itemizing ? 'Itemized deductions' : 'Standard deduction'),
        fromLedger(l, 'md502.20', 'Taxable net income'),
        fromLedger(l, 'md502.21', 'Maryland tax'),
        ...(l.get('md502.21b') > 0 ? [fromLedger(l, 'md502.21b', '2% tax on capital gains')] : []),
        fromLedger(l, 'md502.28', 'Local (county) tax'),
        fromLedger(l, 'md502.34', 'Total tax'),
        fromLedger(l, 'md502.46', 'Total payments'),
        s.md.refund > 0 ? fromLedger(l, 'md502.48', 'Refund') : fromLedger(l, 'md502.47', 'Amount you owe'),
      ],
    },
  ];
}
const maskSsn = (ssn: string) => (ssn.length >= 4 ? `•••-••-${ssn.slice(-4)}` : '—');
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
    {
      id: 'wage-totals',
      title: 'Totals',
      subtitle: null,
      rows: [line(r, 'f1040.1z', 'Total wages'), line(r, 'f1040.25a', 'Federal tax withheld')],
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
      ],
    })),
    {
      id: 'inv-totals',
      title: 'Totals',
      subtitle: null,
      rows: [
        line(r, 'f1040.2b', 'Taxable interest'),
        line(r, 'f1040.3b', 'Ordinary dividends'),
        line(r, 'f1040.3a', 'Qualified dividends', 'Taxed at lower capital gains rates'),
        line(r, 'f1040.7a', 'Capital gain distributions'),
      ],
    },
  ];

  const capped = r.ledger.get('schA.5d') > r.ledger.get('schA.5e');
  const deductions: Card[] = [
    {
      id: 'choice',
      title: r.itemizing ? 'You’re itemizing' : 'You’re taking the standard deduction',
      subtitle: 'We picked whichever is bigger.',
      rows: [line(r, 'f1040.12e', 'Deduction used'), line(r, 'schA.17', 'Itemized total')],
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
  hasApiKey: boolean;
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
    hasApiKey: ctx.hasApiKey,
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
    documents: state.documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      status: d.status,
      kind: KIND[d.docType ?? ''] ?? 'Document',
      issuer: d.classification?.issuerName ?? null,
      pageCount: d.pageCount,
      error: d.error,
      superseded: d.supersededBy !== null,
    })),
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
    proposals: state.proposals.filter((p) => p.status === 'pending'),
    chat: state.chat.messages,
    hasApiKey: ctx.hasApiKey,
    canExport: sections.every((s) => s.id === 'file' || s.status === 'approved') && !flags.some((x) => x.severity === 'blocker'),
  };
}
