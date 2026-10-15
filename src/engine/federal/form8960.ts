import { mulDivToDollar, rateToDollar, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { FilingStatus } from '../../shared/facts';

export interface NiitInput {
  /** Form 1040 line 2b. */
  taxableInterest: Cents;
  /** Form 1040 line 3b. */
  ordinaryDividends: Cents;
  /** 1099-R box 2a for nonqualified annuities (distribution code D). */
  nonqualifiedAnnuities: Cents;
  /** Schedule 1 lines 3 + 5 (business, rentals, royalties, partnerships, S corporations, trusts). */
  scheduleCAndE: Cents;
  /** The part of `scheduleCAndE` that isn't investment income: Schedule C, nonpassive K-1 trade or business
   *  income or loss, and guaranteed payments. Positive when it is net income. */
  nonInvestmentBusinessIncome: Cents;
  /** Form 1040 line 7a + Schedule 1 line 4. */
  dispositions: Cents;
  /** The part of `dispositions` from property held in a nonpassive trade or business. */
  nonInvestmentDispositions: Cents;
  /** State and local income tax deducted on Schedule A after the SALT cap (0 when not itemizing). */
  allowedStateIncomeTax: Cents;
  /** Form 1040 line 11b (MAGI; no foreign earned income exclusion in Tidy's scope). */
  magi: Cents;
}

/** Form 8960 (2025/2026), Net Investment Income Tax — Individuals. Lines 4b and 5b take out nonpassive trade or
 *  business income and gains; line 9b allocates the deducted state income tax by gross investment income over AGI,
 *  a "reasonable method" under the instructions. Writes `f8960.*` and returns line 17. */
export function form8960(i: NiitInput, status: FilingStatus, p: FedParams, l: Ledger): Cents {
  const L1 = l.set('f8960.1', i.taxableInterest, 'Taxable interest');
  const L2 = l.set('f8960.2', i.ordinaryDividends, 'Ordinary dividends');
  const L3 = l.set('f8960.3', i.nonqualifiedAnnuities, 'Annuities from nonqualified plans (1099-R code D)');
  const L4a = l.set('f8960.4a', i.scheduleCAndE, 'Rental real estate, royalties, partnerships, S corporations, trusts, businesses');
  const L4b = l.set('f8960.4b', -i.nonInvestmentBusinessIncome, 'Adjustment for nonpassive trade or business income or loss');
  const L4c = l.set('f8960.4c', L4a + L4b, 'Line 4a + line 4b');
  const L5a = l.set('f8960.5a', i.dispositions, 'Net gain or loss from disposition of property');
  const L5b = l.set('f8960.5b', -i.nonInvestmentDispositions, 'Gain or loss from property held in a nonpassive trade or business');
  const L5d = l.set('f8960.5d', L5a + L5b, 'Net gain or loss', 'Lines 5a through 5c');
  const L8 = l.set('f8960.8', L1 + L2 + L3 + L4c + L5d, 'Total investment income', 'Lines 1, 2, 3, 4c, 5d, 6 and 7');
  const share = i.magi > 0 ? Math.max(0, Math.min(L8, i.magi)) : 0;
  const L9b = l.set(
    'f8960.9b',
    i.allowedStateIncomeTax > 0 && share > 0 ? mulDivToDollar(i.allowedStateIncomeTax, share, i.magi) : 0,
    'State and local income tax allocable to investment income',
    'Deducted state income tax × line 8 ÷ AGI',
  );
  const L9d = l.set('f8960.9d', L9b, 'Total investment expenses', 'Lines 9a + 9b + 9c');
  const L11 = l.set('f8960.11', L9d, 'Total deductions and modifications', 'Line 9d + line 10');
  const L12 = l.set('f8960.12', Math.max(0, L8 - L11), 'Net investment income', 'Line 8 − line 11');
  const L13 = l.set('f8960.13', i.magi, 'Modified adjusted gross income');
  const L14 = l.set('f8960.14', p.niit.threshold[status], 'Threshold for your filing status');
  const L15 = l.set('f8960.15', Math.max(0, L13 - L14), 'Income over the threshold', 'Line 13 − line 14');
  const L16 = l.set('f8960.16', Math.min(L12, L15), 'Smaller of line 12 or line 15');
  return l.set('f8960.17', rateToDollar(L16, p.niit.rate), 'Net investment income tax', 'Line 16 × 3.8%');
}
