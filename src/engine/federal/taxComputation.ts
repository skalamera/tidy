import { usd, type Cents } from '../money';
import { scheduleTax } from '../schedule';
import type { FedParams } from '../params/fed2025';
import type { FilingStatus } from '../../shared/facts';

/** Midpoint of the IRS Tax Table row that contains `ti` (whole-dollar taxable income, in cents). */
export function taxTableMidpoint(ti: Cents): Cents {
  const dollars = Math.floor(ti / 100);
  if (dollars < 5) return usd(2.5);
  if (dollars < 15) return usd(10);
  if (dollars < 25) return usd(20);
  if (dollars < 3_000) return usd(Math.floor(dollars / 25) * 25 + 12.5);
  return usd(Math.floor(dollars / 50) * 50 + 25);
}

/** Regular tax on ordinary taxable income: Tax Table (midpoint) below $100,000, schedule at/above. */
export function taxOnOrdinaryIncome(ti: Cents, status: FilingStatus, p: FedParams): Cents {
  if (ti <= 0) return 0;
  const income = ti < p.taxTableLimit ? taxTableMidpoint(ti) : ti;
  return scheduleTax(income, p.schedules[status]);
}
