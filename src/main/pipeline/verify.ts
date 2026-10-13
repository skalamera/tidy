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

/** Is the amount the model read actually printed on the page it cited?
 *  - blank or zero → verified (nothing to check)
 *  - no text layer (scan/photo) → unverified (a human confirms)
 *  - number not on that page → mismatch (a human confirms, with a stronger warning) */
export function checkAmount(a: AmountT, pageTexts: readonly string[] | null): FieldCheck {
  if (a.amount === null) return 'verified';
  const cents = parseMoney(a.amount);
  if (cents === null) return 'mismatch';
  if (cents === 0) return 'verified';
  if (pageTexts === null) return 'unverified';
  if (a.page === null || a.page < 1 || a.page > pageTexts.length) return 'unverified';
  const text = pageTexts[a.page - 1];
  if (text.replace(/\s/g, '').length < 20) return 'unverified'; // this page is an image
  return amountsOnPage(text).has(Math.abs(cents)) ? 'verified' : 'mismatch';
}

/** Walk any extraction object and check every AmountT inside it. Keys look like "box1Wages", "stateLines.0.stateTax". */
export function checkAllAmounts(data: unknown, pageTexts: readonly string[] | null, prefix = ''): Record<string, FieldCheck> {
  const out: Record<string, FieldCheck> = {};
  if (data === null || typeof data !== 'object') return out;
  const isAmount = (v: unknown): v is AmountT => v !== null && typeof v === 'object' && 'amount' in v && 'quote' in v && 'page' in v;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isAmount(v)) out[key] = checkAmount(v, pageTexts);
    else if (v !== null && typeof v === 'object') Object.assign(out, checkAllAmounts(v, pageTexts, key));
  }
  return out;
}
