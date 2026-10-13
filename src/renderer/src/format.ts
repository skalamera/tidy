const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** Whole dollars for summaries: 1234550 → "$12,346". */
export const usd = (cents: number) => WHOLE.format(Math.round(cents / 100));

/** Dollars and cents: 1234550 → "$12,345.50". */
export const usdExact = (cents: number) => EXACT.format(cents / 100);

/** What a person types ("$12,500.50", "12500") → cents. Null when it isn't a plain, non-negative dollar amount. */
export function parseDollars(input: string): number | null {
  const s = input.replace(/[$,\s]/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
