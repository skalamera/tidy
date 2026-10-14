import { rateToDollar, roundToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { TaxFacts } from '../../shared/facts';

export interface Form8995Result {
  /** Form 1040 line 13a: Qualified business income deduction. */
  deduction: Cents;
  /** Which QBI form must be attached to the return (`null` when no QBI / Section 199A items exist). */
  form: 'f8995' | 'f8995a' | null;
  /** Carryforwards to 2026 (positive magnitudes). */
  carryforwardTo2026: {
    qbiLoss: Cents;
    reitPtpLoss: Cents;
  };
}

/** Form 8995 / Form 8995-A Part IV (2025) — Qualified Business Income / Section 199A REIT Dividends Deduction.
 *  Under IRC §199A(b)(1)(B), qualified REIT dividends (1099-DIV box 5) and publicly traded partnership income
 *  are NOT subject to the W-2 wage / UBIA limitation or SSTB phase-out at any income level.
 *  Taxpayers at or below the threshold ($197,300 Single/MFS/HoH/QSS, $394,600 MFJ) file Form 8995;
 *  taxpayers above the threshold file Form 8995-A (Part IV lines 27–40). */
export function computeForm8995(
  f: TaxFacts,
  i: {
    /** Taxable income before QBI deduction: max(0, AGI - line 12e - line 13b). */
    taxableIncomeBeforeQbi: Cents;
    /** Qualified dividends (Form 1040 line 3a) + net capital gain (min(max(0, Sch D line 15), max(0, Sch D line 16)), or line 7a if no Sch D). */
    netCapitalGainAndQualifiedDividends: Cents;
    /** Net qualified business income (or loss) from Schedule C / pass-through trades or businesses in 2025. */
    tradeOrBusinessQbi?: Cents;
    /** Whether the Schedule C trade or business is a Specified Service Trade or Business (SSTB). */
    isSstb?: boolean;
    /** W-2 wages paid by the Schedule C business (for Form 8995-A above threshold). */
    businessW2Wages?: Cents;
  },
  p: FedParams,
  l: Ledger,
): Form8995Result {
  const reitDividends = sumCents(f.f1099Div.map((d) => roundToDollar(d.box5Section199aDividends)));
  const qbiLossCarry = Math.max(0, roundToDollar(f.carryovers?.qbiLoss ?? 0));
  const reitLossCarry = Math.max(0, roundToDollar(f.carryovers?.reitPtpLoss ?? 0));
  const currentQbi = roundToDollar(i.tradeOrBusinessQbi ?? 0);

  if (currentQbi === 0 && reitDividends === 0 && qbiLossCarry === 0 && reitLossCarry === 0) {
    return { deduction: 0, form: null, carryforwardTo2026: { qbiLoss: 0, reitPtpLoss: 0 } };
  }

  const threshold = p.qbi.threshold[f.filingStatus];
  const phaseIn = p.qbi.phaseInRange[f.filingStatus];
  const uses8995A = i.taxableIncomeBeforeQbi > threshold;

  const netQbiWithCarry = currentQbi - qbiLossCarry;
  const positiveNetQbi = Math.max(0, netQbiWithCarry);
  const qbiLossNextYear = netQbiWithCarry < 0 ? -netQbiWithCarry : 0;

  const netReit = reitDividends - reitLossCarry;
  const L8_or_30 = Math.max(0, netReit);
  const reitComponent = rateToDollar(L8_or_30, p.qbi.rate); // 20% of positive net REIT dividends
  const reitLossNextYear = netReit < 0 ? -netReit : 0;

  const tiLessCapGain = Math.max(0, i.taxableIncomeBeforeQbi - i.netCapitalGainAndQualifiedDividends);
  const incomeLimit = rateToDollar(tiLessCapGain, p.qbi.rate);

  if (!uses8995A) {
    const L2 = l.set('f8995.2', currentQbi, 'Total qualified business income or (loss)');
    const L3 = l.set('f8995.3', qbiLossCarry, 'Qualified business net (loss) carryforward from the prior year');
    const L4 = l.set('f8995.4', positiveNetQbi, 'Total qualified business income');
    const L5 = l.set('f8995.5', rateToDollar(L4, p.qbi.rate), 'Qualified business income component (20%)');
    l.set('f8995.6', reitDividends, 'Qualified REIT dividends and publicly traded partnership (PTP) income');
    l.set('f8995.7', reitLossCarry, 'Qualified REIT dividends and PTP (loss) carryforward from the prior year');
    l.set('f8995.8', L8_or_30, 'Total qualified REIT dividends and PTP income');
    const L9 = l.set('f8995.9', reitComponent, 'REIT and PTP component (20%)');
    const L10 = l.set('f8995.10', L5 + L9, 'Qualified business income deduction before the income limitation');
    l.set('f8995.11', i.taxableIncomeBeforeQbi, 'Taxable income before qualified business income deduction');
    l.set('f8995.12', i.netCapitalGainAndQualifiedDividends, 'Net capital gain increased by qualified dividends');
    l.set('f8995.13', tiLessCapGain, 'Line 11 minus line 12');
    l.set('f8995.14', incomeLimit, 'Income limitation (20% of line 13)');
    const L15 = l.set('f8995.15', Math.min(L10, incomeLimit), 'Qualified business income deduction');
    l.set('f8995.16', qbiLossNextYear, 'Total qualified business (loss) carryforward');
    l.set('f8995.17', reitLossNextYear, 'Total qualified REIT dividends and PTP (loss) carryforward');
    void L2;
    void L3;
    return {
      deduction: L15,
      form: 'f8995',
      carryforwardTo2026: { qbiLoss: qbiLossNextYear, reitPtpLoss: reitLossNextYear },
    };
  }

  // Above threshold -> Form 8995-A
  // Compute QBI component for the trade or business (with SSTB phase-out and W-2 wage limit):
  let qbiComponent = 0;
  if (positiveNetQbi > 0) {
    const over = i.taxableIncomeBeforeQbi - threshold;
    const isSstb = i.isSstb ?? true;
    if (isSstb && over >= phaseIn) {
      // SSTB above top of phase-in range ($247,300 single / $494,600 MFJ) gets $0 QBI deduction
      qbiComponent = 0;
    } else {
      const applicablePct = isSstb ? Math.max(0, 1 - over / phaseIn) : 1;
      const adjQbi = roundToDollar(positiveNetQbi * applicablePct);
      const tentative20 = rateToDollar(adjQbi, p.qbi.rate);
      const w2Limit = roundToDollar(roundToDollar(i.businessW2Wages ?? 0) * applicablePct * 0.5);
      if (over >= phaseIn) {
        qbiComponent = Math.min(tentative20, w2Limit);
      } else {
        const phaseInPct = over / phaseIn;
        const reduction = roundToDollar(Math.max(0, tentative20 - w2Limit) * phaseInPct);
        qbiComponent = Math.max(0, tentative20 - reduction);
      }
    }
  }

  const L27 = l.set('f8995a.27', qbiComponent, 'Total qualified business income component from all qualified trades or businesses');
  l.set('f8995a.28', reitDividends, 'Qualified REIT dividends and publicly traded partnership (PTP) income');
  l.set('f8995a.29', reitLossCarry, 'Qualified REIT dividends and PTP (loss) carryforward from prior years');
  l.set('f8995a.30', L8_or_30, 'Total qualified REIT dividends and PTP income');
  const L31 = l.set('f8995a.31', reitComponent, 'REIT and PTP component (20%)');
  const L32 = l.set('f8995a.32', L27 + L31, 'Qualified business income deduction before the income limitation');
  l.set('f8995a.33', i.taxableIncomeBeforeQbi, 'Taxable income before qualified business income deduction');
  l.set('f8995a.34', i.netCapitalGainAndQualifiedDividends, 'Net capital gain increased by qualified dividends');
  l.set('f8995a.35', tiLessCapGain, 'Line 33 minus line 34');
  l.set('f8995a.36', incomeLimit, 'Income limitation (20% of line 35)');
  const L37 = l.set('f8995a.37', Math.min(L32, incomeLimit), 'Qualified business income deduction before DPAD');
  const L38 = l.set('f8995a.38', 0, 'DPAD under section 199A(g)');
  const L39 = l.set('f8995a.39', L37 + L38, 'Total qualified business income deduction');
  l.set('f8995a.40', reitLossNextYear, 'Total qualified REIT dividends and PTP (loss) carryforward');

  return {
    deduction: L39,
    form: 'f8995a',
    carryforwardTo2026: { qbiLoss: qbiLossNextYear, reitPtpLoss: reitLossNextYear },
  };
}
