const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** Whole dollars for summaries: 1234550 → "$12,346". */
export const usd = (cents: number) => WHOLE.format(Math.round(cents / 100));

/** Dollars and cents: 1234550 → "$12,345.50". */
export const usdExact = (cents: number) => EXACT.format(cents / 100);

/** What a person types ("$12,500.50", "12500") → cents. Null when it isn't a plain dollar amount. Negative amounts
 *  ("-1,250", "(1,250.00)", "−$1,250") only with `allowNegative`, for losses. */
export function parseDollars(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = input.replace(/[$,\s]/g, '').replace(/^\u2212/, '-');
  let negative = false;
  if (opts.allowNegative) {
    const paren = /^\((.*)\)$/.exec(s);
    if (paren) {
      s = paren[1]!;
      negative = true;
    } else if (s.startsWith('-')) {
      s = s.slice(1);
      negative = true;
    }
  }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative && cents > 0 ? -cents : cents;
}

/** The toast after adding files: what was added, and why anything wasn't. Null when nothing was chosen. */
export function addResultText(r: { added: number; duplicates: number; rejected: string[] }): string | null {
  if (r.added + r.duplicates + r.rejected.length === 0) return null;
  const parts: string[] = [];
  if (r.added > 0 || (r.duplicates === 0 && r.rejected.length === 0))
    parts.push(`Added ${r.added} ${r.added === 1 ? 'document' : 'documents'}.`);
  if (r.duplicates > 0) parts.push(`${r.duplicates === 1 ? 'One file was' : `${r.duplicates} files were`} already added.`);
  if (r.rejected.length > 0) parts.push(r.rejected[0]!);
  if (r.rejected.length > 1) parts.push(`${r.rejected.length - 1} more couldn’t be added.`);
  return parts.join(' ');
}
