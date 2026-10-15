import { rateToDollar, sumCents, type Cents } from '../money';
import type { Ledger } from '../ledger';
import type { FedParams } from '../params/fed2025';
import type { FilingStatus, TaxFacts } from '../../shared/facts';

export interface Form6251Input {
  itemizing: boolean;
  /** Schedule 1-A line 37 (deductions the AMT adds back through line 1a). */
  schedule1A: Cents;
  /** Taxable state or local income tax refund on Schedule 1 line 1 (entered on line 2b as a negative). */
  stateRefundIncome: Cents;
  /** AMT depreciation and gain/loss adjustments that come from passive activities (rentals, passive K-1s). */
  passiveAdjustments: Cents;
  /** True when Form 8582 suspended part of a passive loss, so line 2m would partly reverse `passiveAdjustments`. */
  passiveLossLimited: boolean;
  /** Which capital gain worksheet the regular tax used. */
  worksheet: 'qdcg' | 'sdtw' | 'none';
  /** Foreign tax credit claimed without Form 1116 (Schedule 3 line 1), which is also the AMT foreign tax credit. */
  foreignTaxCredit: Cents;
}

export interface Form6251Result {
  /** Line 11, to Schedule 2 line 2. */
  amt: Cents;
  /** Attach Form 6251 (line 7 is more than line 10, or negative adjustments hide AMT). */
  needsForm6251: boolean;
  /** AMT depends on the passive activity adjustment (line 2m), which Tidy doesn't figure yet. Blocks export. */
  passiveUncertain: boolean;
}

/** Tax at the AMT's 26% / 28% rates (Form 6251 lines 7, 18 and 39). */
export function amtRateTax(amount: Cents, status: FilingStatus, p: FedParams): Cents {
  const a = p.amt;
  const t = a.rate28Threshold[status];
  return amount <= t ? rateToDollar(amount, a.rate26) : rateToDollar(amount, a.rate28) - rateToDollar(t, a.rate28 - a.rate26);
}

/** Form 6251 Part II line 5 (with the Exemption Worksheet) through line 7. Reads the regular tax worksheets from
 *  `read`; writes lines only when `l` is given (the what-if runs pass null). */
function tentativeMinimumTax(amti: Cents, f: TaxFacts, i: Form6251Input, p: FedParams, read: Ledger, l: Ledger | null): Cents {
  const s = f.filingStatus;
  const a = p.amt;
  const set = (id: string, v: Cents, label: string, formula?: string) => (l ? l.set(id, v, label, formula) : v);
  const L4 = amti;
  const L5 = set(
    'f6251.5',
    Math.max(0, a.exemption[s] - rateToDollar(Math.max(0, L4 - a.phaseOutStart[s]), a.phaseOutRate)),
    'Exemption',
    'Exemption Worksheet',
  );
  const L6 = set('f6251.6', Math.max(0, L4 - L5), 'Line 4 − line 5');
  if (L6 === 0) return set('f6251.7', 0, 'Tentative minimum tax before the AMT foreign tax credit');
  if (i.worksheet === 'none') return set('f6251.7', amtRateTax(L6, s, p), 'Tax at 26% / 28%');

  // Part III: the same 0% / 15% / 20% / 25% layers as the regular tax worksheets, with the AMT rates on the rest.
  const reg = (id: string) => read.get(id);
  const fromWorksheet = (qdcg: string, sdtw: string) => (i.worksheet === 'qdcg' ? reg(qdcg) : reg(sdtw));
  const L12 = set('f6251.12', L6, 'Amount from line 6');
  const L13 = set('f6251.13', fromWorksheet('qdcg.4', 'sdtw.13'), 'Qualified dividends and capital gains (regular tax worksheet)');
  const L14 = set('f6251.14', reg('schD.19'), 'Unrecaptured section 1250 gain (Schedule D line 19)');
  const L15 = set(
    'f6251.15',
    i.worksheet === 'sdtw' ? Math.min(L13 + L14, reg('sdtw.10')) : L13,
    'Line 13, or lines 13 + 14 limited to Schedule D Tax Worksheet line 10',
  );
  const L16 = set('f6251.16', Math.min(L12, L15), 'Smaller of line 12 or line 15');
  const L17 = set('f6251.17', L12 - L16, 'Line 12 − line 16');
  const L18 = set('f6251.18', amtRateTax(L17, s, p), 'Tax on line 17 at 26% / 28%');
  const L19 = set('f6251.19', p.capitalGains.zeroRateMax[s], '0% rate ceiling');
  const L20 = set('f6251.20', Math.max(0, fromWorksheet('qdcg.5', 'sdtw.14')), 'Ordinary income from the regular tax worksheet');
  const L21 = set('f6251.21', Math.max(0, L19 - L20), 'Line 19 − line 20');
  const L22 = set('f6251.22', Math.min(L12, L13), 'Smaller of line 12 or line 13');
  const L23 = set('f6251.23', Math.min(L21, L22), 'Taxed at 0%');
  const L24 = set('f6251.24', L22 - L23, 'Line 22 − line 23');
  const L25 = set('f6251.25', p.capitalGains.fifteenRateMax[s], '15% rate ceiling');
  const L26 = set('f6251.26', L21, 'Amount from line 21');
  const L27 = set('f6251.27', Math.max(0, fromWorksheet('qdcg.5', 'sdtw.21')), 'Ordinary income from the regular tax worksheet');
  const L28 = set('f6251.28', L26 + L27, 'Line 26 + line 27');
  const L29 = set('f6251.29', Math.max(0, L25 - L28), 'Line 25 − line 28');
  const L30 = set('f6251.30', Math.min(L24, L29), 'Taxed at 15%');
  const L31 = set('f6251.31', rateToDollar(L30, p.capitalGains.rate15), 'Line 30 × 15%');
  const L32 = set('f6251.32', L23 + L30, 'Line 23 + line 30');
  let L34 = 0;
  let L37 = 0;
  if (L32 !== L12) {
    const L33 = set('f6251.33', L22 - L32, 'Taxed at 20%');
    L34 = set('f6251.34', rateToDollar(L33, p.capitalGains.rate20), 'Line 33 × 20%');
    if (L14 !== 0) {
      const L35 = set('f6251.35', L17 + L32 + L33, 'Lines 17 + 32 + 33');
      const L36 = set('f6251.36', Math.max(0, L12 - L35), 'Line 12 − line 35');
      L37 = set('f6251.37', rateToDollar(L36, p.capitalGains.rate25), 'Line 36 × 25%');
    }
  }
  const L38 = set('f6251.38', L18 + L31 + L34 + L37, 'Lines 18 + 31 + 34 + 37');
  const L39 = set('f6251.39', amtRateTax(L12, s, p), 'Tax on line 12 at 26% / 28%');
  const L40 = set('f6251.40', Math.min(L38, L39), 'Smaller of line 38 or line 39');
  return set('f6251.7', L40, 'Tentative minimum tax before the AMT foreign tax credit', 'Part III, line 40');
}

/** Form 6251 (2025/2026), Alternative Minimum Tax — Individuals, Parts I–III for Tidy's scope: the standard
 *  deduction or itemized taxes, refunds, private activity bond interest, the K-1 AMT items Tidy reads, and the
 *  capital gain rates in Part III. Writes `f6251.*` lines. */
export function computeForm6251(f: TaxFacts, i: Form6251Input, p: FedParams, l: Ledger): Form6251Result {
  const L1a = l.set('f6251.1a', l.get('f1040.14') - i.schedule1A, 'Form 1040 line 14 − Schedule 1-A line 37');
  const L1b = l.set('f6251.1b', l.get('f1040.11b') - L1a, 'Form 1040 line 11b − line 1a');
  const L2a = l.set(
    'f6251.2a',
    i.itemizing ? l.get('schA.7') : l.get('f1040.12e'),
    i.itemizing ? 'Taxes (Schedule A line 7)' : 'Standard deduction',
  );
  const L2b = l.set('f6251.2b', -Math.max(0, i.stateRefundIncome), 'State and local income tax refund');
  const L2g = l.set(
    'f6251.2g',
    sumCents([...f.f1099Int.map((x) => x.box9PrivateActivityBondInterest), ...f.f1099Div.map((x) => x.box13PrivateActivityBondDividends)]),
    'Interest from specified private activity bonds',
  );
  const k1s = f.k1s ?? [];
  const L2j = l.set(
    'f6251.2j',
    sumCents(k1s.map((k) => k.amtEstateTrustAdjustment ?? 0)),
    'Estates and trusts (Schedule K-1 (Form 1041), box 12, code A)',
  );
  const L2k = l.set('f6251.2k', sumCents(k1s.map((k) => k.amtGainLossAdjustment ?? 0)), 'Disposition of property (Schedule K-1 AMT items)');
  const L2l = l.set(
    'f6251.2l',
    sumCents(k1s.map((k) => k.amtDepreciationAdjustment ?? 0)),
    'Post-1986 depreciation (Schedule K-1 AMT items)',
  );
  const L3 = l.set('f6251.3', sumCents(k1s.map((k) => k.amtOtherAdjustments ?? 0)), 'Other adjustments (Schedule K-1 AMT items)');
  const adjustments = L2b + L2j + L2k + L2l + L3;
  const L4 = l.set('f6251.4', L1b + L2a + L2g + adjustments, 'Alternative minimum taxable income', 'Lines 1b through 3');

  const L7 = tentativeMinimumTax(L4, f, i, p, l, l);
  const L8 = l.set('f6251.8', Math.min(L7, i.foreignTaxCredit), 'AMT foreign tax credit (same as Schedule 3 line 1, no Form 1116)');
  const L9 = l.set('f6251.9', L7 - L8, 'Tentative minimum tax', 'Line 7 − line 8');
  const L10 = l.set('f6251.10', Math.max(0, l.get('f1040.16') - i.foreignTaxCredit), 'Regular tax (Form 1040 line 16 − Schedule 3 line 1)');
  const L11 = l.set('f6251.11', Math.max(0, L9 - L10), 'Alternative minimum tax', 'Line 9 − line 10');

  // Who must file: AMT is owed, or negative adjustments (lines 2c–3) are the only reason it isn't.
  const withoutNegatives = adjustments < 0 ? tentativeMinimumTax(L4 - adjustments, f, i, p, l, null) : 0;
  const needsForm6251 = L11 > 0 || (adjustments < 0 && withoutNegatives - L8 > L10);

  // Line 2m: when Form 8582 suspends a passive loss, part of the passive AMT adjustments reverses. AMTI then lies
  // between line 4 with and without them; if AMT isn't the same at both ends, Tidy can't say which.
  let passiveUncertain = false;
  if (i.passiveLossLimited && i.passiveAdjustments !== 0) {
    const other = Math.max(0, tentativeMinimumTax(L4 - i.passiveAdjustments, f, i, p, l, null) - L8 - L10);
    passiveUncertain = other !== L11;
  }
  return { amt: L11, needsForm6251, passiveUncertain };
}
