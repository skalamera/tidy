import { formatUsd } from '../engine/money';
import type { ChangeText, Override } from '../shared/state';

/** Segments that would reach JavaScript internals instead of a fact. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Where chat may suggest changes: what documents and last year's return say (amounts, payments, carryovers).
 *  Who you are, filing status, where you live and the yes/no facts come from the user's own answers, which they
 *  change on screen; the tax year is never changed. */
const ROOTS = new Set([
  'w2s',
  'f1099Int',
  'f1099Div',
  'f1099B',
  'f1099R',
  'f1099Nec',
  'ssa1099',
  'scheduleC',
  'rentals',
  'k1s',
  'carryovers',
  'itemized',
  'payments',
  'stateReturn',
  'mdDecoupling',
]);
/** Never changed from chat anywhere: where an amount was found and whether it was checked. */
const NEVER = new Set(['evidence']);

/** Facts that may be empty (null or left out), with the kind of value a suggestion may put there. */
const EMPTY_KIND: Record<string, 'boolean' | 'number'> = {
  priorYearFederalAgi: 'number',
  priorYearFederalTax: 'number',
  homeStateMuniInterest: 'number',
  priorYearMdTax: 'number',
};

/** Text facts a suggestion may change, with the values they take. Every other text fact comes from a document or an
 *  answer. */
const TEXT_CHOICES: Record<string, readonly string[]> = { owner: ['taxpayer', 'spouse'] };

/** Largest amount a suggestion may set: $1 trillion in cents, far beyond any household and well inside safe integers. */
const MAX_NUMBER = 100_000_000_000_000;
const MAX_DEPTH = 8;

type Kind = 'number' | 'boolean' | 'choice';
interface Slot {
  node: Record<string, unknown>;
  key: string;
  current: unknown;
  kind: Kind | null;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The fact `path` names: object keys, or array items by their `id`. Null when the path doesn't reach an existing
 *  slot (a stale or invented path), or would pass through anything that isn't the facts' own data. */
function locate(root: unknown, path: unknown): Slot | null {
  if (!Array.isArray(path) || path.length === 0 || path.length > MAX_DEPTH) return null;
  const allowed = ROOTS.has(path[0] as string) && !path.some((s) => NEVER.has(s as string));
  let node: unknown = root;
  for (let i = 0; i < path.length; i++) {
    const seg: unknown = path[i];
    if (typeof seg !== 'string' || seg === '' || FORBIDDEN.has(seg)) return null;
    if (node === null || typeof node !== 'object') return null;
    const last = i === path.length - 1;
    if (Array.isArray(node)) {
      if (last) return null; // a whole document or item is never replaced
      node = node.find((x: unknown) => x !== null && typeof x === 'object' && own(x, 'id') && (x as { id: unknown }).id === seg);
      continue;
    }
    const obj = node as Record<string, unknown>;
    if (!last) {
      if (!own(obj, seg)) return null;
      node = obj[seg];
      continue;
    }
    if (seg === 'id') return null;
    const present = own(obj, seg);
    if (!present && !own(EMPTY_KIND, seg)) return null;
    const current = present ? obj[seg] : undefined;
    return { node: obj, key: seg, current, kind: allowed ? kindOf(seg, current) : null };
  }
  return null;
}

function kindOf(key: string, current: unknown): Kind | null {
  if (typeof current === 'number') return 'number';
  if (typeof current === 'boolean') return 'boolean';
  if (typeof current === 'string') return own(TEXT_CHOICES, key) && TEXT_CHOICES[key].includes(current) ? 'choice' : null;
  if (current === null || current === undefined) return own(EMPTY_KIND, key) ? EMPTY_KIND[key] : null;
  return null;
}

/** Why a suggested change can't be made, as a sentence for the AI (and the log), or null when it can. Checks that
 *  the path names an existing fact Tidy lets chat change, and that the value has that fact's type. */
export function overrideProblem(facts: object, path: unknown, value: unknown): string | null {
  const slot = locate(facts, path);
  if (!slot) return 'That path doesn’t name a fact on this return. Use find_facts to see the facts chat can change and their paths.';
  switch (slot.kind) {
    case null:
      return 'That fact can’t be changed from chat. It comes from one of the user’s answers or their identity documents, which they change on screen.';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'That fact is a yes or no, so the value must be true or false.';
    case 'choice':
      return typeof value === 'string' && TEXT_CHOICES[slot.key].includes(value)
        ? null
        : `That fact must be one of: ${TEXT_CHOICES[slot.key].join(', ')}.`;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_NUMBER)
        return 'That fact is a number, so the value must be a number (money in integer cents, e.g. 8600000 for $86,000).';
      const whole = typeof slot.current !== 'number' || Number.isInteger(slot.current);
      return whole && !Number.isSafeInteger(value)
        ? 'That fact takes a whole number (money in integer cents, e.g. 8600000 for $86,000).'
        : null;
    }
  }
}

/** Apply overrides in order to a copy of `base`. One that no longer fits (its document is gone, or it was saved by an
 *  older Tidy without these checks) is skipped and returned in `skipped`, never thrown: a stale path must not stop
 *  the whole return from working out. */
export function applyOverrides<T extends object>(base: T, overrides: readonly Override[]): { facts: T; skipped: Override[] } {
  const facts = structuredClone(base);
  const skipped: Override[] = [];
  for (const o of overrides) {
    const slot = overrideProblem(facts, o.path, o.value) === null ? locate(facts, o.path) : null;
    if (slot) slot.node[slot.key] = o.value;
    else skipped.push(o);
  }
  return { facts, skipped };
}

/** A fact chat may change: its path, its wording and its current value. */
export interface EditableFact {
  path: string[];
  label: string;
  value: unknown;
}

/** Every fact `propose_change` accepts, worded like the cards (for the AI's find_facts tool). */
export function editableFacts(facts: object): EditableFact[] {
  const out: EditableFact[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (path.length >= MAX_DEPTH || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) {
        const id: unknown = item !== null && typeof item === 'object' && own(item, 'id') ? (item as { id: unknown }).id : null;
        if (typeof id === 'string' && id !== '') walk(item, [...path, id]);
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'id' || FORBIDDEN.has(key) || NEVER.has(key) || (path.length === 0 && !ROOTS.has(key))) continue;
      if (value !== null && typeof value === 'object') walk(value, [...path, key]);
      else if (kindOf(key, value) !== null) out.push({ path: [...path, key], label: factLabel(facts, [...path, key]), value });
    }
  };
  walk(facts, []);
  return out;
}

// ---------- words for the screen ----------

const COLLECTIONS: Record<string, string> = {
  w2s: 'W-2',
  f1099Int: '1099-INT',
  f1099Div: '1099-DIV',
  f1099B: '1099-B',
  f1099R: '1099-R',
  f1099Nec: '1099-NEC',
  ssa1099: 'SSA-1099',
  scheduleC: 'Business',
  rentals: 'Rental',
  k1s: 'K-1',
};
const NAME_KEYS = ['employerName', 'payerName', 'entityName', 'businessName', 'address', 'description'] as const;
/** Number facts that aren't money. */
const PLAIN_NUMBER = /(Days|SqFt|Ppm|Years|Count|Percent|Type)$/;

/** Abbreviations in fact keys, as people say them. */
const SAY: Record<string, string> = {
  ss: 'Social Security',
  fed: 'federal',
  qbi: 'QBI',
  reit: 'REIT',
  ptp: 'PTP',
  amt: 'AMT',
  ira: 'IRA',
  sep: 'SEP',
  ltc: 'LTC',
  pso: 'PSO',
  nec: 'NEC',
  md: 'Maryland',
  muni: 'municipal',
  fbar: 'FBAR',
};

const words = (key: string): string => {
  const spaced = key
    .replace(/^box(\d+[a-z]?)/, 'Box $1 ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .map((w) => SAY[w] ?? w)
    .join(' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

function valueText(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'Blank';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number')
    return PLAIN_NUMBER.test(key) ? value.toLocaleString('en-US') : formatUsd(value, { cents: value % 100 !== 0 });
  if (key === 'owner') return value === 'spouse' ? 'Your spouse' : value === 'taxpayer' ? 'You' : String(value);
  return String(value);
}

/** "W-2 from Acme Corp: Box 1 wages", from the facts themselves. */
export function factLabel(facts: object, path: readonly string[]): string {
  const parts: string[] = [];
  let node: unknown = facts;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (Array.isArray(node)) {
      const item: unknown = node.find(
        (x: unknown) => x !== null && typeof x === 'object' && own(x, 'id') && (x as { id: unknown }).id === seg,
      );
      const name = item
        ? NAME_KEYS.map((k) => (item as Record<string, unknown>)[k]).find((v) => typeof v === 'string' && v.trim())
        : undefined;
      const form = COLLECTIONS[path[i - 1]] ?? 'Item';
      parts.pop();
      parts.push(typeof name === 'string' ? `${form} from ${name.trim()}` : form);
      node = item;
      continue;
    }
    parts.push(words(seg));
    node = node !== null && typeof node === 'object' && own(node, seg) ? (node as Record<string, unknown>)[seg] : undefined;
  }
  const field = parts.pop() ?? '';
  return parts.length ? `${parts.join(', ')}: ${field}` : field;
}

/** Old → new for a change, worded from the facts. `before` is what the fact is now (or was, for a saved change). */
export function changeText(facts: object, path: readonly string[], value: unknown, before?: unknown): ChangeText {
  const key = path[path.length - 1] ?? '';
  const current = before !== undefined ? before : locate(facts, path)?.current;
  return { label: factLabel(facts, path), before: valueText(key, current), after: valueText(key, value) };
}

/** The current value of a fact, for remembering what a change replaced. */
export function factValue(facts: object, path: readonly string[]): unknown {
  return locate(facts, path)?.current ?? null;
}
