import { rateToDollar, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { FilingStatus } from '../../shared/facts';

export interface NiitInput {
  taxableInterest: Cents; // 1040 line 2b
  ordinaryDividends: Cents; // 1040 line 3b
  netGain: Cents; // 1040 line 7a (Phase 7 replaces with Schedule D detail)
  magi: Cents; // AGI + foreign earned income exclusion (Phase 1: AGI)
}

/** Form 8960 Net Investment Income Tax — individuals (lines 1, 2, 5a, 8, 9–12, 13–17).
 *  Phase-1 scope: no investment-expense allocation on line 9b (flagged as a possible saving in review). */
export function form8960(i: NiitInput, status: FilingStatus, p: FedParams, l: Ledger): Cents {
  const L1 = l.set('f8960.1', i.taxableInterest, 'Taxable interest');
  const L2 = l.set('f8960.2', i.ordinaryDividends, 'Ordinary dividends');
  const L5a = l.set('f8960.5a', i.netGain, 'Net gain from selling investments');
  const L5d = l.set('f8960.5d', L5a, 'Net gain or loss', 'Lines 5a through 5c');
  const L8 = l.set('f8960.8', L1 + L2 + L5d, 'Total investment income', 'Lines 1 + 2 + 3 + 4c + 5d + 6 + 7');
  const L11 = l.set('f8960.11', 0, 'Investment expenses');
  const L12 = l.set('f8960.12', Math.max(0, L8 - L11), 'Net investment income');
  const L13 = l.set('f8960.13', i.magi, 'Modified adjusted gross income');
  const L14 = l.set('f8960.14', p.niit.threshold[status], 'Threshold for your filing status');
  const L15 = l.set('f8960.15', Math.max(0, L13 - L14), 'Income over the threshold');
  const L16 = l.set('f8960.16', Math.min(L12, L15), 'Smaller of line 12 or 15');
  return l.set('f8960.17', rateToDollar(L16, p.niit.rate), 'Net investment income tax (3.8%)');
}
