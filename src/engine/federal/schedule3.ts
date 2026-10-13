import { rateToCents, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { Owner, TaxFacts } from '../../shared/facts';

/** Excess social security tax withheld (Schedule 3 line 11). Figured per person, and only when that
 *  person had 2+ employers. (One employer over-withholding must refund it; it is never claimed here.) */
export function excessSocialSecurity(f: TaxFacts, p: FedParams): Cents {
  const maxWithholding = rateToCents(p.socialSecurity.wageBase, p.socialSecurity.employeeRate); // $10,918.20
  let excess = 0;
  for (const owner of ['taxpayer', 'spouse'] as Owner[]) {
    const w2s = f.w2s.filter((w) => w.owner === owner);
    if (w2s.length < 2) continue;
    excess += Math.max(0, sumCents(w2s.map((w) => w.box4SsWithheld)) - maxWithholding);
  }
  return excess;
}

/** Schedule 3 (2025), Phase-1 lines: 8 (no credits yet), 10, 11, 15. */
export function schedule3(f: TaxFacts, p: FedParams, l: Ledger): { nonrefundableCredits: Cents; otherPayments: Cents } {
  const L8 = l.set('sch3.8', 0, 'Total nonrefundable credits');
  const L10 = l.set('sch3.10', f.payments.federalExtensionPayment, 'Paid with extension request');
  const L11 = l.set('sch3.11', excessSocialSecurity(f, p), 'Excess social security tax withheld');
  const L15 = l.set('sch3.15', L10 + L11, 'Total other payments and refundable credits');
  return { nonrefundableCredits: L8, otherPayments: L15 };
}
