import { rateToDollar, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { FilingStatus } from '../../shared/facts';
import { taxOnOrdinaryIncome } from './taxComputation';

export interface QdcgInput {
  taxableIncome: Cents; // Form 1040 line 15
  qualifiedDividends: Cents; // Form 1040 line 3a
  /** Smaller of Schedule D line 15 or 16 (0 if either is a loss), or Form 1040 line 7a if no Schedule D. */
  netCapitalGainForWorksheet: Cents;
}

/** Qualified Dividends and Capital Gain Tax Worksheet — Line 16 (2025 Form 1040 instructions).
 *  Writes lines qdcg.1 … qdcg.25 to the ledger and returns line 25 (the tax). */
export function qdcgWorksheet(i: QdcgInput, status: FilingStatus, p: FedParams, l: Ledger): Cents {
  const L1 = l.set('qdcg.1', i.taxableIncome, 'Taxable income');
  const L2 = l.set('qdcg.2', i.qualifiedDividends, 'Qualified dividends');
  const L3 = l.set('qdcg.3', Math.max(0, i.netCapitalGainForWorksheet), 'Net capital gain');
  const L4 = l.set('qdcg.4', L2 + L3, 'Lines 2 + 3');
  const L5 = l.set('qdcg.5', Math.max(0, L1 - L4), 'Ordinary income part', 'Line 1 − line 4');
  const L6 = l.set('qdcg.6', p.capitalGains.zeroRateMax[status], '0% rate limit');
  const L7 = l.set('qdcg.7', Math.min(L1, L6), 'Smaller of line 1 or line 6');
  const L8 = l.set('qdcg.8', Math.min(L5, L7), 'Smaller of line 5 or line 7');
  const L9 = l.set('qdcg.9', L7 - L8, 'Taxed at 0%');
  const L10 = l.set('qdcg.10', Math.min(L1, L4), 'Smaller of line 1 or line 4');
  const L11 = l.set('qdcg.11', L9, 'Amount from line 9');
  const L12 = l.set('qdcg.12', L10 - L11, 'Line 10 − line 11');
  const L13 = l.set('qdcg.13', p.capitalGains.fifteenRateMax[status], '15% rate limit');
  const L14 = l.set('qdcg.14', Math.min(L1, L13), 'Smaller of line 1 or line 13');
  const L15 = l.set('qdcg.15', L5 + L9, 'Lines 5 + 9');
  const L16 = l.set('qdcg.16', Math.max(0, L14 - L15), 'Line 14 − line 15');
  const L17 = l.set('qdcg.17', Math.min(L12, L16), 'Taxed at 15%');
  const L18 = l.set('qdcg.18', rateToDollar(L17, p.capitalGains.rate15), '15% tax');
  const L19 = l.set('qdcg.19', L9 + L17, 'Lines 9 + 17');
  const L20 = l.set('qdcg.20', L10 - L19, 'Taxed at 20%');
  const L21 = l.set('qdcg.21', rateToDollar(L20, p.capitalGains.rate20), '20% tax');
  const L22 = l.set('qdcg.22', taxOnOrdinaryIncome(L5, status, p), 'Tax on ordinary income (line 5)');
  const L23 = l.set('qdcg.23', L18 + L21 + L22, 'Lines 18 + 21 + 22');
  const L24 = l.set('qdcg.24', taxOnOrdinaryIncome(L1, status, p), 'Tax on all taxable income at ordinary rates');
  return l.set('qdcg.25', Math.min(L23, L24), 'Tax (smaller of line 23 or 24)');
}
