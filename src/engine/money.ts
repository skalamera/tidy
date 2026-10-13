/**
 * Money is ALWAYS an integer number of cents. Never do tax math with floating-point dollars.
 * Rates are integer parts-per-million (ppm): 1% = 10_000 ppm, 3.078% = 30_780 ppm.
 */
export type Cents = number;
export type Ppm = number;

/** Dollars → cents. Use only for constants and test fixtures (max 2 decimals). */
export const usd = (dollars: number): Cents => Math.round(dollars * 100);

/** "3.078" → 30780 ppm. Accepts up to 4 decimals so every published rate is exact. */
export function pct(text: string): Ppm {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) throw new Error(`pct(): invalid percentage "${text}"`);
  return Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'));
}

/** Round the exact value (num / den) cents to whole dollars, IRS style:
 *  drop amounts under 50 cents, raise 50–99 cents to the next dollar. Symmetric for negatives. */
export function roundRationalToDollar(num: bigint, den: bigint): Cents {
  if (den === 0n) throw new Error('roundRationalToDollar(): division by zero');
  const negative = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const dollars = (n * 2n + 100n * d) / (200n * d);
  return Number(negative ? -dollars : dollars) * 100;
}

/** Whole-dollar rounding of an integer cents amount. */
export function roundToDollar(c: Cents): Cents {
  if (!Number.isInteger(c)) throw new Error(`roundToDollar(): not integer cents: ${c}`);
  return roundRationalToDollar(BigInt(c), 1n);
}

/** amount × rate, rounded ONCE to whole dollars (no double rounding). */
export function rateToDollar(amount: Cents, rate: Ppm): Cents {
  return roundRationalToDollar(BigInt(amount) * BigInt(rate), 1_000_000n);
}

/** amount × num / den, rounded once to whole dollars. */
export function mulDivToDollar(amount: Cents, num: number, den: number): Cents {
  return roundRationalToDollar(BigInt(amount) * BigInt(num), BigInt(den));
}

/** amount × rate rounded half-up to the nearest CENT (for caps such as the $10,918.20 SS maximum). */
export function rateToCents(amount: Cents, rate: Ppm): Cents {
  const n = BigInt(amount) * BigInt(rate);
  const negative = n < 0n;
  const a = negative ? -n : n;
  const q = (a * 2n + 1_000_000n) / 2_000_000n;
  return Number(negative ? -q : q);
}

/** Parse a printed amount ("12,345.67", "$1,000", "(1,234.00)", "-5") into cents. null if not money. */
export function parseMoney(text: string): Cents | null {
  const t = text.trim();
  if (t === '') return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith('-');
  const cleaned = t.replace(/[()$,\s-]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export const sumCents = (xs: readonly Cents[]): Cents => xs.reduce((s, x) => s + x, 0);

/** "$12,345" (or "$12,345.67" with cents: true). */
export function formatUsd(c: Cents, opts: { cents?: boolean } = {}): string {
  const digits = opts.cents ? 2 : 0;
  return (c / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
