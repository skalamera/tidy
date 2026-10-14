import type { FederalResult } from '../engine/federal/form1040';
import { computeStateReturn } from '../engine/state';
import type { TaxFacts } from '../shared/facts';
import type { AppState, SectionId, SectionStatus } from '../shared/state';

export interface SectionDef {
  id: SectionId;
  title: string;
  /** lucide-react icon name used by the renderer. */
  icon: string;
  blurb: string;
  /** Everything the user is approving in this section. If it changes, approval goes stale. */
  snapshot(facts: TaxFacts, result: FederalResult, state: AppState): unknown;
}

const lines = (r: FederalResult, ids: string[]) => Object.fromEntries(ids.map((id) => [id, r.ledger.get(id)]));
const noEvidence = <T extends { evidence?: unknown }>(xs: T[]) => xs.map(({ evidence: _e, ...rest }) => rest);

export const SECTIONS: SectionDef[] = [
  {
    id: 'profile',
    title: 'About you',
    icon: 'UserRound',
    blurb: 'Names, filing status, and where you lived.',
    snapshot: (f) => ({ s: f.filingStatus, t: f.taxpayer, sp: f.spouse, a: f.address, r: f.residency, d: f.digitalAssets }),
  },
  {
    id: 'documents',
    title: 'Your documents',
    icon: 'FileStack',
    blurb: 'Everything we found, and anything still missing.',
    snapshot: (_f, _r, s) => ({ docs: s.documents.map((d) => [d.sha256, d.status, d.supersededBy]), exp: s.expected }),
  },
  {
    id: 'wages',
    title: 'Wages & income',
    icon: 'BriefcaseBusiness',
    blurb: 'Pay, self-employment, retirement distributions, and Social Security.',
    snapshot: (f, r) => ({
      w2s: noEvidence(f.w2s),
      r1099: noEvidence(f.f1099R ?? []),
      nec: noEvidence(f.f1099Nec ?? []),
      ssa: noEvidence(f.ssa1099 ?? []),
      schc: f.scheduleC ?? [],
      basis: f.hasNondeductibleIraBasis ?? null,
      l: lines(r, [
        'f1040.1z',
        'f1040.4a',
        'f1040.4b',
        'f1040.5a',
        'f1040.5b',
        'f1040.6a',
        'f1040.6b',
        'f1040.8',
        'f1040.10',
        'f1040.25a',
        'schC.31',
        'schSE.12',
      ]),
    }),
  },
  {
    id: 'investments',
    title: 'Investments',
    icon: 'TrendingUp',
    blurb: 'Interest, dividends, and sales of stocks or funds.',
    snapshot: (f, r) => ({
      i: noEvidence(f.f1099Int),
      d: noEvidence(f.f1099Div),
      b: noEvidence(f.f1099B ?? []),
      c: f.carryovers ?? null,
      fa: f.foreignAccounts,
      l: lines(r, ['f1040.2b', 'f1040.3a', 'f1040.3b', 'f1040.7a', 'schD.7', 'schD.15', 'schD.16']),
    }),
  },
  {
    id: 'deductions',
    title: 'Deductions',
    icon: 'HandCoins',
    blurb: 'Standard deduction or itemizing, whichever saves more.',
    snapshot: (f, r) => ({ it: f.itemized, l: lines(r, ['schA.5e', 'schA.17', 'f1040.12e', 'f1040.13a', 'f1040.13b', 'f1040.14']) }),
  },
  {
    id: 'payments',
    title: 'Payments',
    icon: 'Landmark',
    blurb: 'Tax already withheld or paid for 2025.',
    snapshot: (f, r) => ({ p: f.payments, l: lines(r, ['f1040.25d', 'f1040.26', 'f1040.33']) }),
  },
  {
    id: 'federal_summary',
    title: 'Federal summary',
    icon: 'Flag',
    blurb: 'Your Form 1040 at a glance.',
    snapshot: (_f, r) => r.ledger.toRecord('f1040.'),
  },
  {
    id: 'state_summary',
    title: 'State return',
    icon: 'MapPinned',
    blurb: 'Your Maryland resident return.',
    snapshot: (f, r) => {
      const s = computeStateReturn(f, r);
      return s ? s.md.ledger.toRecord() : null;
    },
  },
  {
    id: 'final_review',
    title: 'Final check',
    icon: 'ShieldCheck',
    blurb: 'A last look for anything missed.',
    snapshot: (_f, r) => r.ledger.toRecord(),
  },
  {
    id: 'file',
    title: 'Print & file',
    icon: 'Printer',
    blurb: 'Your print-ready return and how to file it.',
    snapshot: () => 'file',
  },
];

/** cyrb53: fast 53-bit string hash (public domain). Approval staleness needs change detection, not cryptography,
 *  and a pure-JS hash keeps core/ free of Node imports. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Hash of JSON with sorted keys, so property order never changes the hash. */
export function stableHash(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v;
  return cyrb53(JSON.stringify(sorted(value)));
}

export interface SectionState {
  id: SectionId;
  title: string;
  icon: string;
  blurb: string;
  status: SectionStatus;
  openQuestions: number;
  hash: string;
}

/** Sections unlock strictly in order: you approve one before the next opens. */
export function sectionStates(state: AppState, facts: TaxFacts, result: FederalResult): SectionState[] {
  const busy = state.documents.some((d) => d.status === 'queued' || d.status === 'reading');
  let blocked = false;
  return SECTIONS.map((def) => {
    const hash = stableHash(def.snapshot(facts, result, state));
    const open = state.questions.filter((q) => q.sectionId === def.id && q.blocking && q.answer === null).length;
    const approval = state.approvals[def.id];
    let status: SectionStatus;
    // An approval counts only while nothing in the step is waiting for an answer: a question that appears later
    // (say, one Tidy didn't ask before) re-opens the step even though the facts it shows haven't changed yet.
    if (approval && approval.snapshotHash === hash && open === 0) status = 'approved';
    else if (blocked) status = approval ? 'needs_reapproval' : 'locked';
    else if (busy) status = 'working';
    else if (open > 0) status = 'needs_answers';
    else status = approval ? 'needs_reapproval' : 'ready';
    if (status !== 'approved') blocked = true;
    return { id: def.id, title: def.title, icon: def.icon, blurb: def.blurb, status, openQuestions: open, hash };
  });
}
