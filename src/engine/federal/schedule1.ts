import { roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';

/** The State and Local Income Tax Refund Worksheet (2025 Form 1040 instructions, Schedule 1 line 1). Returns the
 *  taxable part of a 2024 state or local income tax refund received in 2025. The worksheet's exceptions (refunds
 *  for other years, 2024 AMT, a joint 2024 state return without a joint 2025 return, 2024 estimates paid in 2025)
 *  need Publication 525 instead, and block export (see flags). */
export function stateRefundWorksheet(f: TaxFacts, p: FedParams, l: Ledger): Cents {
  const w = f.stateRefund;
  const prior = w?.priorYear;
  if (!w || w.refund <= 0 || !prior?.itemized || prior.itemized.salesTaxElected) return 0;
  const it = prior.itemized;
  const L1 = l.set(
    'srw.1',
    Math.min(roundToDollar(w.refund), roundToDollar(it.line5d)),
    'Income tax refund (no more than 2024 Schedule A line 5d)',
  );
  const over = roundToDollar(it.line5d) - roundToDollar(it.line5e);
  const L2 = l.set('srw.2', Math.max(0, over), '2024 state and local taxes over the deduction limit (line 5d − line 5e)');
  const L3 = l.set('srw.3', Math.max(0, L1 - L2), 'Refund that lowered your 2024 deduction');
  const L4 = l.set('srw.4', roundToDollar(it.line17), '2024 total itemized deductions (Schedule A line 17)');
  const single = prior.filingStatus === 'single' || prior.filingStatus === 'hoh';
  const L5 = l.set('srw.5', p.priorYear.standardDeduction[prior.filingStatus], '2024 standard deduction for your filing status');
  const L6 = l.set(
    'srw.6',
    prior.ageOrBlindBoxes * (single ? p.priorYear.additional65OrBlind.singleOrHoh : p.priorYear.additional65OrBlind.marriedOrQss),
    '2024 boxes for age 65 or blindness',
  );
  const L7 = l.set('srw.7', L5 + L6, '2024 standard deduction you could have taken');
  const L8 = l.set('srw.8', Math.max(0, L4 - L7), 'Itemized deductions over the standard deduction');
  return l.set('srw.9', Math.min(L3, L8), 'Taxable part of your refund', 'Smaller of line 3 or line 8');
}

/** Schedule 1 lines 1 and 7: the taxable state refund and unemployment compensation (1099-G). */
export function otherSchedule1Income(f: TaxFacts, p: FedParams, l: Ledger): { line1: Cents; line7: Cents } {
  const refund = stateRefundWorksheet(f, p, l);
  const line1 = refund > 0 ? l.set('sch1.1', refund, 'Taxable refunds of state and local income taxes', 'Refund worksheet line 9') : 0;
  const unemployment = roundToDollar(sumCents((f.f1099G ?? []).map((g) => g.box1Unemployment)));
  const line7 = unemployment !== 0 ? l.set('sch1.7', unemployment, 'Unemployment compensation (1099-G box 1)') : 0;
  return { line1, line7 };
}
