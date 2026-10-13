import { parseMoney, type Cents } from '../engine/money';
import type { AmountT } from '../shared/schemas/extraction';

/** "12,345.67" → cents; blank or unreadable → 0. */
export const amountCents = (a: AmountT): Cents => (a.amount === null ? 0 : (parseMoney(a.amount) ?? 0));

/** Read an AmountT out of extraction data by dotted path ("box1Wages", "stateLines.0.stateTax"). */
export function amountAt(data: unknown, path: string): AmountT | null {
  let node: unknown = data;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[key];
  }
  const a = node as AmountT | undefined;
  return a && typeof a === 'object' && 'amount' in a && 'quote' in a ? a : null;
}
