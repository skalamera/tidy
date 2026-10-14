import { rateToDollar, roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { FilingStatus, TaxFacts } from '../../shared/facts';

/** State and Local Tax Deduction Worksheet (2025 Schedule A instructions) → Schedule A line 5e. */
export function saltDeduction(line5d: Cents, magi: Cents, status: FilingStatus, p: FedParams): Cents {
  const mfs = status === 'mfs';
  if (line5d <= (mfs ? p.salt.noLimitAtOrBelowMfs : p.salt.noLimitAtOrBelow)) return line5d;
  const threshold = mfs ? p.salt.magiThresholdMfs : p.salt.magiThreshold;
  let line9 = p.salt.cap;
  if (magi > threshold) {
    const line7 = rateToDollar(magi - threshold, p.salt.phaseDownRate);
    line9 = Math.max(p.salt.cap - line7, p.salt.floor);
  }
  const allowed = mfs ? roundToDollar(line9 / 2) : line9; // MFS: half of line 9
  return Math.min(allowed, line5d);
}

/** Schedule A (2025), lines 1–17, Phase-1 scope: no charitable AGI limits, no mortgage-debt limits,
 *  no Form 4952 (those are added in Phase 7). Returns line 17. */
export function scheduleA(f: TaxFacts, agi: Cents, p: FedParams, l: Ledger): Cents {
  const it = f.itemized;
  const L1 = l.set('schA.1', it.medicalExpenses, 'Medical and dental expenses');
  const L2 = l.set('schA.2', agi, 'Adjusted gross income');
  const L3 = l.set('schA.3', rateToDollar(L2, p.medicalFloorRate), '7.5% of AGI');
  const L4 = l.set('schA.4', Math.max(0, L1 - L3), 'Deductible medical');

  const withheldStateLocal = sumCents([
    ...f.w2s.flatMap((w) => [...w.stateLines.map((s) => s.stateTax), ...w.localLines.map((x) => x.localTax)]),
    ...(f.f1099R ?? []).flatMap((r) => r.stateLines.map((s) => s.stateTax)),
  ]);
  const paidOther = sumCents(it.stateIncomeTaxPayments.map((x) => x.amount));
  const L5a = l.set('schA.5a', withheldStateLocal + paidOther, 'State and local income taxes');
  const L5b = l.set('schA.5b', it.realEstateTax, 'Real estate taxes');
  const L5c = l.set('schA.5c', it.personalPropertyTax, 'Personal property taxes');
  const L5d = l.set('schA.5d', L5a + L5b + L5c, 'Total state and local taxes');
  const L5e = l.set('schA.5e', saltDeduction(L5d, agi, f.filingStatus, p), 'State and local taxes you can deduct (SALT cap)');
  const L7 = l.set('schA.7', L5e, 'Total taxes');

  const L8a = l.set('schA.8a', it.mortgageInterest1098, 'Home mortgage interest (Form 1098)');
  const L8e = l.set('schA.8e', L8a, 'Total home mortgage interest');
  const L9 = l.set('schA.9', it.investmentInterest, 'Investment interest');
  const L10 = l.set('schA.10', L8e + L9, 'Total interest');

  const L11 = l.set('schA.11', it.charityCash, 'Gifts by cash or check');
  const L12 = l.set('schA.12', it.charityNonCash, 'Gifts other than cash');
  const L13 = l.set('schA.13', it.charityCarryover, 'Carryover from prior year');
  const L14 = l.set('schA.14', L11 + L12 + L13, 'Total gifts to charity');

  return l.set('schA.17', L4 + L7 + L10 + L14, 'Total itemized deductions');
}
