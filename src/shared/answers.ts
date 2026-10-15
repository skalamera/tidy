import type { QuestionKind } from './state';

/** Answers to the "who you are" questions: how the screen sends them, and how the facts read them. */
export interface NameAnswer {
  first: string;
  last: string;
}
export interface AddressAnswer {
  street: string;
  apt: string | null;
  city: string;
  state: string;
  zip: string;
}

/** The 9 digits of an SSN (or ITIN), or null. Dashes and spaces are fine. */
export function ssnDigits(text: string): string | null {
  const digits = text.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(digits) ? digits : null;
}

export function nameAnswer(first: string, last: string): NameAnswer | null {
  const n = { first: first.trim(), last: last.trim() };
  return n.first && n.last ? n : null;
}

export function addressAnswer(a: { street: string; apt: string; city: string; state: string; zip: string }): AddressAnswer | null {
  const out = {
    street: a.street.trim(),
    apt: a.apt.trim() || null,
    city: a.city.trim(),
    state: a.state.trim().toUpperCase(),
    zip: a.zip.trim(),
  };
  return out.street && out.city && /^[A-Z]{2}$/.test(out.state) && /^\d{5}(-\d{4})?$/.test(out.zip) ? out : null;
}

const fieldsOf = (answer: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(answer);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function parseName(answer: string): NameAnswer | null {
  const v = fieldsOf(answer);
  const [first, last] = [str(v?.first), str(v?.last)];
  return first === null || last === null ? null : nameAnswer(first, last);
}

export function parseAddress(answer: string): AddressAnswer | null {
  const v = fieldsOf(answer);
  const [street, city, state, zip] = [str(v?.street), str(v?.city), str(v?.state), str(v?.zip)];
  if (street === null || city === null || state === null || zip === null) return null;
  return addressAnswer({ street, apt: str(v?.apt) ?? '', city, state, zip });
}

/** Whole cents as the screen sends them ("1250050"), up to $10 trillion; a minus sign for amounts that can be negative. */
const CENTS = /^-?\d{1,15}$/;
const MAX_LINE: Record<'lines' | 'counts' | 'area', number> = { lines: 1e15, counts: 366, area: 1_000_000 };

/** A `lines`, `counts` (days) or `area` (square feet) answer: JSON of line → non-negative whole number, every line
 *  one of the question's. */
export function parseLines(
  answer: string,
  lines?: readonly { value: string }[] | null,
  kind: 'lines' | 'counts' | 'area' = 'lines',
): Record<string, number> | null {
  const v = fieldsOf(answer);
  if (!v || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (lines && !lines.some((l) => l.value === k)) return null;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_LINE[kind]) return null;
    out[k] = n;
  }
  return out;
}

/** A date of birth typed as MM/DD/YYYY (or YYYY-MM-DD) → "YYYY-MM-DD", or null if it isn't a real date in
 *  1900–2025. */
export function birthDate(text: string): string | null {
  const t = text.trim();
  const us = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [y, m, d] = us ? [+us[3]!, +us[1]!, +us[2]!] : iso ? [+iso[1]!, +iso[2]!, +iso[3]!] : [0, 0, 0];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2025 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "04/27/1958" for "1958-04-27". */
export const dateText = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};

/** The answer as Tidy stores it, or null when it can't be used. This is the trust boundary: the screen checks too, but
 *  nothing the renderer sends reaches the facts unless it has the question's shape. */
export function normalAnswer(q: { kind: QuestionKind; choices: { value: string }[] | null }, answer: string): string | null {
  switch (q.kind) {
    case 'ssn':
      return ssnDigits(answer);
    case 'name': {
      const n = parseName(answer);
      return n && JSON.stringify(n);
    }
    case 'address': {
      const a = parseAddress(answer);
      return a && JSON.stringify(a);
    }
    case 'yes_no':
      return answer === 'yes' || answer === 'no' ? answer : null;
    case 'choice':
      return q.choices?.some((c) => c.value === answer) ? answer : null;
    case 'money':
      return CENTS.test(answer) ? String(Number.parseInt(answer, 10)) : null;
    case 'confirm_amount':
      return answer === 'yes' || CENTS.test(answer) ? answer : null;
    case 'text': {
      const t = answer.trim();
      return t !== '' && t.length <= 500 ? t : null;
    }
    case 'lines':
    case 'counts':
    case 'area': {
      const v = q.choices ? parseLines(answer, q.choices, q.kind) : null;
      return v && JSON.stringify(v);
    }
    case 'date':
      return birthDate(answer);
  }
}

export const maskSsn = (ssn: string) => (ssn.length >= 4 ? `•••-••-${ssn.slice(-4)}` : '—');
export const addressText = (a: AddressAnswer) => [a.street, a.apt, a.city, `${a.state} ${a.zip}`].filter(Boolean).join(', ');
