import { roundRationalToDollar, type Cents, type Ppm } from './money';

/** One row of a published rate schedule: "over $X, the tax is $base plus rate of the excess over $X".
 *  Use the PUBLISHED base amounts — some states round them, and recomputing them causes $1 drift. */
export interface ScheduleRow {
  over: Cents;
  base: Cents;
  rate: Ppm;
}

/** Tax from a published schedule, rounded once to whole dollars. Rows must be sorted by `over`. */
export function scheduleTax(income: Cents, rows: readonly ScheduleRow[]): Cents {
  if (income <= 0) return 0;
  let row = rows[0];
  for (const r of rows) if (income > r.over) row = r;
  // base + (income - over) * rate / 1e6, computed exactly then rounded once.
  const scaled = BigInt(row.base) * 1_000_000n + BigInt(income - row.over) * BigInt(row.rate);
  return roundRationalToDollar(scaled, 1_000_000n);
}
