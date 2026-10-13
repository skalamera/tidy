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

/** The answer as Tidy stores it, or null when it can't be used. Kinds without a fixed shape pass through. */
export function normalAnswer(kind: QuestionKind, answer: string): string | null {
  switch (kind) {
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
    default:
      return answer;
  }
}

export const maskSsn = (ssn: string) => (ssn.length >= 4 ? `•••-••-${ssn.slice(-4)}` : '—');
export const addressText = (a: AddressAnswer) => [a.street, a.apt, a.city, `${a.state} ${a.zip}`].filter(Boolean).join(', ');
