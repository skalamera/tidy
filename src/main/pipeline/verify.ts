import { parseMoney, type Cents } from '../../engine/money';
import type { AmountT } from '../../shared/schemas/extraction';
import type { FieldCheck } from '../../shared/state';

const MONEY_TOKEN = /\(?-?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?|\(?-?\$?\s?\d+(?:\.\d{2})?\)?/g;

/** Every money-looking number printed on a page, as cents. */
export function amountsOnPage(text: string): Set<Cents> {
  const out = new Set<Cents>();
  for (const m of text.matchAll(MONEY_TOKEN)) {
    const c = parseMoney(m[0].replace(/\s/g, ''));
    if (c !== null) out.add(Math.abs(c));
  }
  return out;
}

/** Boxes every form of a kind fills in. One that comes back blank is more likely missed than empty, so it's asked
 *  about instead of counting as 0. (A sale's cost basis is blank for shares the broker doesn't track: then the
 *  user must supply it.) */
export const REQUIRED_BOXES: Partial<Record<string, RegExp>> = {
  w2: /^(box1Wages|box3SsWages|box5MedicareWages)$/,
  f1099_r: /^box1GrossDistribution$/,
  f1099_nec: /^box1NonemployeeCompensation$/,
  ssa_1099: /^box5NetBenefits$/,
  f1098: /^box1MortgageInterest$/,
  f1099_b: /^lots\.\d+\.(proceeds|costBasis)$/,
};

/** Is the amount the model read actually printed on the page it cited?
 *  - blank → verified, unless the box is one every such form fills in (`required`) → missing (a human checks)
 *  - zero → verified (nothing to check)
 *  - no text layer (scan/photo) → unverified (a human confirms)
 *  - number not on that page → mismatch (a human confirms, with a stronger warning)
 *  A one-page text (a CSV download) is the page for an amount that cites none. */
export function checkAmount(a: AmountT, pageTexts: readonly string[] | null, required = false): FieldCheck {
  if (a.amount === null) return required ? 'missing' : 'verified';
  const cents = parseMoney(a.amount);
  if (cents === null) return 'mismatch';
  if (cents === 0) return 'verified';
  if (pageTexts === null) return 'unverified';
  const page = a.page ?? (pageTexts.length === 1 ? 1 : null);
  if (page === null || page < 1 || page > pageTexts.length) return 'unverified';
  const text = pageTexts[page - 1];
  if (text.replace(/\s/g, '').length < 20) return 'unverified'; // this page is an image
  return amountsOnPage(text).has(Math.abs(cents)) ? 'verified' : 'mismatch';
}

/** Walk any extraction object and check every AmountT inside it. Keys look like "box1Wages", "stateLines.0.stateTax".
 *  `form` names the extraction, for its required boxes. */
export function checkAllAmounts(data: unknown, pageTexts: readonly string[] | null, form = '', prefix = ''): Record<string, FieldCheck> {
  const out: Record<string, FieldCheck> = {};
  if (data === null || typeof data !== 'object') return out;
  const isAmount = (v: unknown): v is AmountT => v !== null && typeof v === 'object' && 'amount' in v && 'quote' in v && 'page' in v;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isAmount(v)) out[key] = checkAmount(v, pageTexts, REQUIRED_BOXES[form]?.test(key) ?? false);
    else if (v !== null && typeof v === 'object') Object.assign(out, checkAllAmounts(v, pageTexts, form, key));
  }
  return out;
}
