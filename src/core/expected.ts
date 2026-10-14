import type { AppState, DocumentRecord } from '../shared/state';
import type { DocType, PriorYearExtractionT } from '../shared/schemas/extraction';
import { latestPriorYear } from './deriveFacts';

const STOP = new Set([
  'inc',
  'llc',
  'lp',
  'llp',
  'corp',
  'corporation',
  'co',
  'company',
  'na',
  'the',
  'and',
  'of',
  'bank',
  'trust',
  'financial',
  'services',
  'group',
]);

/** "Charles Schwab & Co., Inc." → ["charles", "schwab"] */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** True when two payer names share most of their meaningful words (Jaccard ≥ 0.5). */
export function sameIssuer(a: string, b: string): boolean {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return false;
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / (A.size + B.size - inter) >= 0.5;
}

const FORM_TO_DOCTYPES: Record<string, DocType[]> = {
  w2: ['w2'],
  f1099_int: ['f1099_int', 'f1099_composite'],
  f1099_div: ['f1099_div', 'f1099_composite'],
  f1099_r: ['f1099_r'],
  f1099_nec: ['f1099_nec', 'f1099_composite'],
  ssa_1099: ['ssa_1099'],
  f1099_b: ['f1099_b', 'f1099_composite'],
  k1: ['k1_1065', 'k1_1120s', 'k1_1041'],
  f1098: ['f1098'],
  other: [],
};

/** One expected item per (payer, form) from last year's return. Key is stable across re-derivations. */
export function expectedFromPriorYear(prior: PriorYearExtractionT): { key: string; name: string; form: string }[] {
  const seen = new Map<string, { key: string; name: string; form: string }>();
  for (const p of prior.payers) {
    if (p.form === 'other') continue;
    const key = `${p.form}:${nameTokens(p.name).join('-')}`;
    if (!seen.has(key)) seen.set(key, { key, name: p.name, form: p.form });
  }
  return [...seen.values()];
}

/** The documents to expect: the payers on the 2024 return Tidy is using, each keeping its "Not this year" answer.
 *  Rebuilt with the questions, so removing that return removes them and a return for another year adds none.
 *  While a file is still being read it might be last year's return, so the list waits for it. */
export function expectedNow(state: AppState): AppState['expected'] {
  if (state.documents.some((d) => d.status === 'queued' || d.status === 'reading')) return state.expected;
  const prior = latestPriorYear(state);
  if (!prior) return [];
  const notThisYear = new Set(state.expected.filter((e) => e.dismissed).map((e) => e.key));
  return expectedFromPriorYear(prior).map((e) => ({ ...e, dismissed: notThisYear.has(e.key) }));
}

export function isReceived(item: { name: string; form: string }, docs: readonly DocumentRecord[]): boolean {
  const types = FORM_TO_DOCTYPES[item.form] ?? [];
  return docs.some(
    (d) =>
      d.status === 'done' &&
      d.docType !== null &&
      types.includes(d.docType) &&
      d.classification?.issuerName != null &&
      sameIssuer(d.classification.issuerName, item.name),
  );
}

/** Expected items still missing (not received and not dismissed). */
export function missingExpected(state: AppState) {
  return state.expected.filter((e) => !e.dismissed && !isReceived(e, state.documents));
}
