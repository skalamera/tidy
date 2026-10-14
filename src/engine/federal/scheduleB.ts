import { roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { TaxFacts } from '../../shared/facts';

export interface ScheduleBResult {
  taxableInterest: Cents; // → Form 1040 line 2b
  ordinaryDividends: Cents; // → Form 1040 line 3b
  interestPayers: { name: string; amount: Cents }[];
  dividendPayers: { name: string; amount: Cents }[];
}

/** Schedule B (2025) Parts I and II. Payers are listed as on the 1099s (brokerage name + total). */
export function scheduleB(f: TaxFacts, l: Ledger): ScheduleBResult {
  const interestPayers = [
    ...f.f1099Int.map((x) => ({ name: x.payerName, amount: x.box1Interest + x.box3UsTreasuryInterest })),
    ...(f.f1099B ?? [])
      .map((b) => ({
        name: `${b.payerName} (accrued market discount)`,
        amount: sumCents(b.lots.map((lot) => roundToDollar(lot.marketDiscount))),
      }))
      .filter((x) => x.amount > 0),
  ];
  const dividendPayers = f.f1099Div.map((x) => ({ name: x.payerName, amount: x.box1aOrdinaryDividends }));
  const L2 = l.set('schB.2', sumCents(interestPayers.map((x) => x.amount)), 'Total interest');
  const L4 = l.set('schB.4', L2, 'Taxable interest', 'Line 2 − line 3');
  const L6 = l.set('schB.6', sumCents(dividendPayers.map((x) => x.amount)), 'Total ordinary dividends');
  return { taxableInterest: L4, ordinaryDividends: L6, interestPayers, dividendPayers };
}
