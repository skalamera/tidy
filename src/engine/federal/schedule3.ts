import { rateToCents, roundToDollar, sumCents, usd, type Cents } from '../money';
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

/** Foreign tax on 1099-INT box 6 and 1099-DIV box 7. */
export const foreignTaxPaid = (f: TaxFacts): Cents =>
  sumCents([...f.f1099Int.map((x) => x.box6ForeignTaxPaid), ...f.f1099Div.map((x) => x.box7ForeignTaxPaid)]);

/** Up to $300 ($600 married filing jointly) of foreign tax on 1099 interest and dividends can be claimed without
 *  Form 1116 (§904(j); Form 1040 instructions, Schedule 3 line 1). */
export const foreignTaxNo1116Limit = (f: TaxFacts): Cents => usd(f.filingStatus === 'mfj' ? 600 : 300);

export const simpleForeignTaxCreditAllowed = (f: TaxFacts): boolean => {
  const paid = foreignTaxPaid(f);
  return paid > 0 && paid <= foreignTaxNo1116Limit(f);
};

/** Schedule 3 line 1 without Form 1116: the smaller of the foreign tax and Form 1040 line 16 (plus Schedule 2 line
 *  1a, which Tidy never has), once the user confirms the other conditions. Set before Form 6251, whose line 8 uses it. */
export function foreignTaxCredit(f: TaxFacts, line16: Cents, l: Ledger): Cents {
  if (f.claimForeignTaxCredit !== true || !simpleForeignTaxCreditAllowed(f)) return 0;
  const credit = Math.min(roundToDollar(foreignTaxPaid(f)), line16);
  return credit > 0 ? l.set('sch3.1', credit, 'Foreign tax credit (no Form 1116)', 'Smaller of 1099 foreign tax or Form 1040 line 16') : 0;
}

/** Schedule 3 (2025): line 1 (foreign tax credit, set earlier), 8, 10, 11, 15. */
export function schedule3(f: TaxFacts, p: FedParams, l: Ledger): { nonrefundableCredits: Cents; otherPayments: Cents } {
  const L8 = l.set('sch3.8', l.get('sch3.1'), 'Total nonrefundable credits', 'Line 1');
  const L10 = l.set('sch3.10', f.payments.federalExtensionPayment, 'Paid with extension request');
  const L11 = l.set('sch3.11', excessSocialSecurity(f, p), 'Excess social security tax withheld');
  const L15 = l.set('sch3.15', L10 + L11, 'Total other payments and refundable credits');
  return { nonrefundableCredits: L8, otherPayments: L15 };
}
