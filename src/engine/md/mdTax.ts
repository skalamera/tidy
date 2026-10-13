import { rateToDollar, usd, type Cents } from '../money';
import { scheduleTax } from '../schedule';
import type { MdCounty, MdParams } from '../params/md2025';
import type { FilingStatus } from '../../shared/facts';

const isJoint = (s: FilingStatus) => s === 'mfj' || s === 'hoh' || s === 'qss';

/** Midpoint of the MD tax-table row containing `ti`. Rows: [0,50) → $0, [50,75) [75,100), then $50 wide. */
export function mdTableMidpoint(ti: Cents): Cents | null {
  const d = Math.floor(ti / 100);
  if (d < 50) return null; // tax is $0
  if (d < 100) return usd(Math.floor(d / 25) * 25 + 12.5);
  return usd(Math.floor(d / 50) * 50 + 25);
}

/** Form 502 line 21 — Maryland state tax before the 2% capital gain tax. */
export function mdStateTax(ti: Cents, status: FilingStatus, p: MdParams): Cents {
  if (ti <= 0) return 0;
  if (ti < p.taxTableLimit) {
    const mid = mdTableMidpoint(ti);
    return mid === null ? 0 : scheduleTax(mid, p.schedules[status]);
  }
  return scheduleTax(ti, p.schedules[status]);
}

/** Form 502 line 28 — county / Baltimore City income tax on taxable net income. */
export function mdLocalTax(ti: Cents, county: MdCounty, status: FilingStatus, p: MdParams): Cents {
  if (ti <= 0) return 0;
  const rule = p.local[county];
  const joint = isJoint(status);
  switch (rule.kind) {
    case 'flat':
      return rateToDollar(ti, rule.rate);
    case 'marginal':
      return scheduleTax(ti, joint ? rule.schedules.joint : rule.schedules.unmarried);
    case 'tiered': {
      const tiers = joint ? rule.tiers.joint : rule.tiers.unmarried;
      const t = tiers.find((x) => x.upTo === null || ti <= x.upTo)!;
      return rateToDollar(ti, t.rate);
    }
  }
}

/** Value of ONE personal/dependent exemption for this FAGI (chart 10A). Age/blind $1,000 extras are separate. */
export function mdExemptionValue(fagi: Cents, status: FilingStatus, p: MdParams): Cents {
  const chart = isJoint(status) ? p.exemption.joint : p.exemption.unmarried;
  for (const [over, value] of chart) if (fagi > over) return value;
  return p.exemption.amount;
}

/** Worksheet 14A — itemized deduction phase-out amount (Form 502 line 17c). */
export function mdItemizedPhaseOut(fagi: Cents, status: FilingStatus, p: MdParams): Cents {
  const threshold = status === 'mfs' ? p.itemizedPhaseOut.thresholdMfs : p.itemizedPhaseOut.threshold;
  return fagi > threshold ? rateToDollar(fagi - threshold, p.itemizedPhaseOut.rate) : 0;
}

/** Form 502 line 21b — 2% additional tax on net capital gain (Form 502CG line for the subject amount). */
export function mdCapitalGainSurtax(fagi: Cents, netCapitalGainSubject: Cents, p: MdParams): Cents {
  if (fagi <= p.capitalGainSurtax.fagiThreshold || netCapitalGainSubject <= 0) return 0;
  return rateToDollar(netCapitalGainSubject, p.capitalGainSurtax.rate);
}
