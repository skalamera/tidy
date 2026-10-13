import { rateToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';

/** Form 8959 Additional Medicare Tax, Parts I, IV, V (wages only; self-employment and RRTA arrive in Phase 7). */
export function form8959(f: TaxFacts, p: FedParams, l: Ledger): { tax: Cents; withholding: Cents } {
  const L1 = l.set('f8959.1', sumCents(f.w2s.map((w) => w.box5MedicareWages)), 'Medicare wages (W-2 box 5)');
  const L4 = l.set('f8959.4', L1, 'Total Medicare wages');
  const L5 = l.set('f8959.5', p.additionalMedicare.threshold[f.filingStatus], 'Threshold for your filing status');
  const L6 = l.set('f8959.6', Math.max(0, L4 - L5), 'Wages over the threshold');
  const L7 = l.set('f8959.7', rateToDollar(L6, p.additionalMedicare.rate), 'Additional Medicare Tax on wages (0.9%)');
  const L18 = l.set('f8959.18', L7, 'Total Additional Medicare Tax');
  const L19 = l.set('f8959.19', sumCents(f.w2s.map((w) => w.box6MedicareWithheld)), 'Medicare tax withheld (W-2 box 6)');
  const L20 = l.set('f8959.20', L1, 'Medicare wages');
  const L21 = l.set('f8959.21', rateToDollar(L20, p.additionalMedicare.regularRate), 'Regular Medicare withholding (1.45%)');
  const L22 = l.set('f8959.22', Math.max(0, L19 - L21), 'Additional Medicare Tax withheld');
  const L24 = l.set('f8959.24', L22, 'Total Additional Medicare Tax withholding');
  return { tax: L18, withholding: L24 };
}
