import { rateToDollar, sumCents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';

/** Form 6251 (2025) lines 1b–11, taxing ALL of line 6 at 26%/28%. Part III (lower AMT rates on qualified
 *  dividends and capital gains) can only lower line 7, so when this upper bound is not above the regular tax,
 *  AMT is certainly $0 and Form 6251 isn't needed. When it is above, Tidy stops and says AMT isn't supported yet. */
export function amtScreen(f: TaxFacts, itemizing: boolean, p: FedParams, l: Ledger): { mayOweAmt: boolean } {
  const s = f.filingStatus;
  const a = p.amt;
  const L1b = l.set('amt.1b', l.get('f1040.11b') - l.get('f1040.14'), 'AGI minus deductions');
  const L2a = l.set('amt.2a', itemizing ? l.get('schA.7') : l.get('f1040.12e'), itemizing ? 'Taxes from Schedule A' : 'Standard deduction');
  const L2g = l.set(
    'amt.2g',
    sumCents([...f.f1099Int.map((x) => x.box9PrivateActivityBondInterest), ...f.f1099Div.map((x) => x.box13PrivateActivityBondDividends)]),
    'Private activity bond interest',
  );
  const L4 = l.set('amt.4', L1b + L2a + L2g, 'Alternative minimum taxable income');
  const L5 = l.set(
    'amt.5',
    Math.max(0, a.exemption[s] - rateToDollar(Math.max(0, L4 - a.phaseOutStart[s]), a.phaseOutRate)),
    'AMT exemption',
  );
  const L6 = l.set('amt.6', Math.max(0, L4 - L5), 'Line 4 − line 5');
  const t = a.rate28Threshold[s];
  const L7 = l.set(
    'amt.7max',
    L6 <= t ? rateToDollar(L6, a.rate26) : rateToDollar(L6, a.rate28) - rateToDollar(t, a.rate28 - a.rate26),
    'Tentative minimum tax (upper bound)',
  );
  const L10 = l.set('amt.10', l.get('f1040.16'), 'Regular tax');
  const L11 = l.set('amt.11max', Math.max(0, L7 - L10), 'Possible AMT (upper bound)');
  return { mayOweAmt: L11 > 0 };
}
