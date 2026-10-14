import { rateToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';

/** Form 8959 Additional Medicare Tax, Parts I, II, IV, V (wages + Schedule SE self-employment income). */
export function form8959(f: TaxFacts, p: FedParams, l: Ledger, seNetEarnings: Cents = 0): { tax: Cents; withholding: Cents } {
  const L1 = l.set('f8959.1', sumCents(f.w2s.map((w) => w.box5MedicareWages)), 'Medicare wages (W-2 box 5)');
  const L4 = l.set('f8959.4', L1, 'Total Medicare wages');
  const threshold = p.additionalMedicare.threshold[f.filingStatus];
  const L5 = l.set('f8959.5', threshold, 'Threshold for your filing status');
  const L6 = l.set('f8959.6', Math.max(0, L4 - L5), 'Wages over the threshold');
  const L7 = l.set('f8959.7', rateToDollar(L6, p.additionalMedicare.rate), 'Additional Medicare Tax on wages (0.9%)');

  // Part II — Additional Medicare Tax on Self-Employment Income (lines 8–13)
  let L13 = 0;
  if (seNetEarnings > 0) {
    const L8 = l.set('f8959.8', seNetEarnings, 'Self-employment income from Schedule SE, line 6');
    const L9 = l.set('f8959.9', threshold, 'Threshold for your filing status');
    const L10 = l.set('f8959.10', L4, 'Total Medicare wages from line 4');
    const L11 = l.set('f8959.11', Math.max(0, L9 - L10), 'Remaining threshold after Medicare wages');
    const L12 = l.set('f8959.12', Math.max(0, L8 - L11), 'Self-employment income over the threshold');
    L13 = l.set('f8959.13', rateToDollar(L12, p.additionalMedicare.rate), 'Additional Medicare Tax on self-employment income (0.9%)');
  }

  const L18 = l.set('f8959.18', L7 + L13, 'Total Additional Medicare Tax');
  const L19 = l.set('f8959.19', sumCents(f.w2s.map((w) => w.box6MedicareWithheld)), 'Medicare tax withheld (W-2 box 6)');
  const L20 = l.set('f8959.20', L1, 'Medicare wages');
  const L21 = l.set('f8959.21', rateToDollar(L20, p.additionalMedicare.regularRate), 'Regular Medicare withholding (1.45%)');
  const L22 = l.set('f8959.22', Math.max(0, L19 - L21), 'Additional Medicare Tax withheld');
  const L24 = l.set('f8959.24', L22, 'Total Additional Medicare Tax withholding');
  return { tax: L18, withholding: L24 };
}
