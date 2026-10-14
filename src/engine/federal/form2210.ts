import type { TaxFacts } from '../../shared/facts';
import type { Ledger } from '../ledger';
import { type Cents, rateToDollar, roundToDollar, sumCents, usd } from '../money';

export interface Form2210Result {
  /** Penalty reported on Form 2210 line 19 and Form 1040 line 38. */
  penalty: Cents;
  /** True if Form 2210 must be attached to the return (when a Part II box A–E applies or when `computeForm2210` is explicitly set with a penalty). */
  needsForm2210: boolean;
  /** Which pages of `f2210.pdf` to include (`[0]` for Box A/E only, `[0, 1]` when Part III is completed). */
  pages: number[];
  /** Non-money printed fields and checkboxes on `f2210.pdf`. */
  printed: Record<string, string | boolean>;
}

/** Convert a `YYYY-MM-DD` date in 2025/2026 to its Table 4-1 day index (where `2025-04-15` = 0 and `2026-04-15` = 365). */
export function dayIndexFrom20250415(isoDate: string): number {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 365;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = Date.UTC(2025, 3, 15); // April 15, 2025
  return Math.max(0, Math.min(365, Math.round((t - base) / 86_400_000)));
}

/**
 * Compute Form 2210 (2025) — Underpayment of Estimated Tax by Individuals, Estates, and Trusts (Regular Method).
 *
 * Implements:
 * - Part I: Required Annual Payment (lines 1–9), including the $1,000 threshold on lines 4 & 7 and the 90% vs 100%/110% prior-year tax safe harbor on lines 5, 8, & 9.
 * - Part II: Reasons for Filing (boxes A–E).
 * - Part III Section A: Figure Your Underpayment by quarter (columns (a) 4/15/25, (b) 6/15/25, (c) 9/15/25, (d) 1/15/26, lines 10–18).
 * - Part III Section B: Penalty Worksheet (Rate Periods 1–4 at 7% simple daily interest over 365 days -> line 19 -> Form 1040 line 38).
 */
export function computeForm2210(
  f: TaxFacts,
  i: {
    /** Form 1040 line 22: tax after nonrefundable credits. */
    line22TaxAfterCredits: Cents;
    /** Other taxes for Form 2210 line 2: Schedule SE self-employment tax + Form 8959 Additional Medicare Tax + Form 8960 NIIT. */
    line2OtherTaxes: Cents;
    /** Refundable credits for Form 2210 line 3 (excluding excess SS tax on Schedule 3 line 11, which goes to line 6 withholding). */
    line3RefundableCredits: Cents;
    /** Withholding taxes for Form 2210 line 6: Form 1040 line 25d + Schedule 3 line 11 excess Social Security tax withheld. */
    line6Withholding: Cents;
  },
  l: Ledger,
): Form2210Result {
  const printed: Record<string, string | boolean> = {};
  const boxes = f.payments.form2210Boxes ?? [];
  const wants2210 = Boolean(f.payments.computeForm2210) || boxes.length > 0;

  if (!wants2210) {
    return { penalty: 0, needsForm2210: false, pages: [0, 1], printed };
  }

  // Part I — Required Annual Payment
  const L1 = l.set('f2210.1', roundToDollar(i.line22TaxAfterCredits), '2025 tax after credits (Form 1040, line 22)');
  const L2 = l.set('f2210.2', roundToDollar(i.line2OtherTaxes), 'Other taxes (SE tax, Additional Medicare Tax, NIIT)');
  const L3 = l.set('f2210.3', roundToDollar(i.line3RefundableCredits), 'Other payments and refundable credits');
  const L4 = l.set('f2210.4', L1 + L2 - L3, 'Current year tax');
  const L5 = l.set('f2210.5', rateToDollar(L4, 900_000), '90% of current year tax');
  const L6 = l.set('f2210.6', roundToDollar(i.line6Withholding), 'Withholding taxes');
  const L7 = l.set('f2210.7', L4 - L6, 'Current year tax minus withholding');

  // If line 4 < $1,000 or line 7 < $1,000, stop: no penalty owed
  if (L4 < usd(1_000) || L7 < usd(1_000)) {
    return { penalty: 0, needsForm2210: false, pages: [0, 1], printed };
  }

  // Line 8: Prior-year safe harbor (100% of 2024 tax, or 110% if 2024 AGI > $150,000 / $75,000 MFS)
  const priorTax = f.payments.priorYearFederalTax != null ? roundToDollar(f.payments.priorYearFederalTax) : null;
  const priorAgi = f.payments.priorYearFederalAgi != null ? roundToDollar(f.payments.priorYearFederalAgi) : 0;
  const highIncomeThreshold = f.filingStatus === 'mfs' ? usd(75_000) : usd(150_000);
  const priorMultiplierPpm = priorAgi > highIncomeThreshold ? 1_100_000 : 1_000_000;

  let L8 = 0;
  let L9 = L5;
  if (priorTax !== null && priorTax > 0) {
    L8 = l.set('f2210.8', rateToDollar(priorTax, priorMultiplierPpm), 'Maximum required annual payment based on prior year tax');
    L9 = l.set('f2210.9', Math.min(L5, L8), 'Required annual payment (smaller of line 5 or line 8)');
  } else {
    L9 = l.set('f2210.9', L5, 'Required annual payment');
  }

  for (const b of boxes) {
    printed[`f2210.box${b}`] = true;
  }

  if (L9 <= L6) {
    printed['f2210.line9No'] = true;
    const needsPage1ForBoxE = boxes.includes('E');
    return { penalty: 0, needsForm2210: needsPage1ForBoxE, pages: [0], printed };
  }

  printed['f2210.line9Yes'] = true;
  if (boxes.includes('A') && !boxes.includes('B') && !boxes.includes('C') && !boxes.includes('D')) {
    // Full waiver requested on Box A -> file page 1 only, penalty = 0
    return { penalty: 0, needsForm2210: true, pages: [0], printed };
  }

  // Part III Section A — Figure Your Underpayment (columns a, b, c, d)
  const cols = ['a', 'b', 'c', 'd'] as const;
  const reqPerQuarter = roundToDollar(Math.round(L9 / 4));
  const whPerQuarter = roundToDollar(Math.round(L6 / 4));

  // Map estimated payments + prior-year overpayment applied to the 4 installment periods
  const estByQuarter: [Cents, Cents, Cents, Cents] = [roundToDollar(f.payments.federalPriorYearApplied), 0, 0, 0];

  if (f.payments.federalEstimatedDated && f.payments.federalEstimatedDated.length > 0) {
    for (const p of f.payments.federalEstimatedDated) {
      const amt = roundToDollar(p.amount);
      if (p.datePaid <= '2025-04-15') estByQuarter[0] += amt;
      else if (p.datePaid <= '2025-06-15') estByQuarter[1] += amt;
      else if (p.datePaid <= '2025-09-15') estByQuarter[2] += amt;
      else estByQuarter[3] += amt;
    }
  } else {
    f.payments.federalEstimated.slice(0, 4).forEach((amt, idx) => {
      estByQuarter[idx] += roundToDollar(amt);
    });
    for (const extra of f.payments.federalEstimated.slice(4)) {
      estByQuarter[3] += roundToDollar(extra);
    }
  }

  const L10: [Cents, Cents, Cents, Cents] = [reqPerQuarter, reqPerQuarter, reqPerQuarter, L9 - 3 * reqPerQuarter];
  const L11: [Cents, Cents, Cents, Cents] = [
    whPerQuarter + estByQuarter[0],
    whPerQuarter + estByQuarter[1],
    whPerQuarter + estByQuarter[2],
    L6 - 3 * whPerQuarter + estByQuarter[3],
  ];

  const L12: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  const L13: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  const L14: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  const L15: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  const L16: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  const L17: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];
  const L18: [Cents, Cents, Cents, Cents] = [0, 0, 0, 0];

  for (let q = 0; q < 4; q++) {
    const c = cols[q]!;
    l.set(`f2210.10.${c}`, L10[q]!, `Required installment (${c})`);
    l.set(`f2210.11.${c}`, L11[q]!, `Estimated tax paid and tax withheld (${c})`);
    if (q === 0) {
      L15[0] = l.set('f2210.15.a', L11[0]!, 'Column (a) line 15');
    } else {
      L12[q] = l.set(`f2210.12.${c}`, L18[q - 1]!, `Overpayment from previous column (${c})`);
      L13[q] = l.set(`f2210.13.${c}`, L11[q]! + L12[q]!, `Line 11 + line 12 (${c})`);
      L14[q] = l.set(`f2210.14.${c}`, L16[q - 1]! + L17[q - 1]!, `Lines 16 + 17 from previous column (${c})`);
      L15[q] = l.set(`f2210.15.${c}`, Math.max(0, L13[q]! - L14[q]!), `Line 13 minus line 14 (${c})`);
      L16[q] = l.set(`f2210.16.${c}`, L15[q]! === 0 ? Math.max(0, L14[q]! - L13[q]!) : 0, `Remaining prior underpayment (${c})`);
    }
    if (L10[q]! >= L15[q]!) {
      L17[q] = l.set(`f2210.17.${c}`, L10[q]! - L15[q]!, `Underpayment (${c})`);
      L18[q] = l.set(`f2210.18.${c}`, 0, `Overpayment (${c})`);
    } else {
      L17[q] = l.set(`f2210.17.${c}`, 0, `Underpayment (${c})`);
      L18[q] = l.set(`f2210.18.${c}`, L15[q]! - L10[q]!, `Overpayment (${c})`);
    }
  }

  // Part III Section B — Figure the Penalty (Worksheet for Form 2210, Part III, Section B)
  // Per IRS Form 2210 instructions (p. 6–8), only estimated tax payments (not withholding on line 11) are entered on line 1b of the Penalty Worksheet
  // to pay down an earlier column's underpayment. When no subsequent estimated payments are applied on line 1b, each column's line 17 underpayment
  // accrues simple daily interest at 7% (0.07 / 365) from its payment due date through April 15, 2026 (365, 304, 212, and 90 days respectively).
  // When subsequent estimated payments ARE made, they pay down the oldest unpaid underpayment first on the date made.
  const dueDay: [number, number, number, number] = [0, 61, 153, 275];
  const intervalDays: [number, number, number, number] = [61, 92, 122, 90];
  const hasEstimatedPayments = sumCents(estByQuarter) > 0;

  let exactPenaltyCents = 0;
  if (!hasEstimatedPayments) {
    // Only withholding: each quarter's net underpayment (L10[q] - L11[q]) remains unpaid from dueDay[q] to day 365 (04/15/26).
    for (let q = 0; q < 4; q++) {
      const qUnder = Math.max(0, L10[q]! - L11[q]!);
      const daysUnpaid = 365 - dueDay[q]!;
      exactPenaltyCents += (qUnder * daysUnpaid * 7) / (365 * 100);
    }
  } else {
    for (let q = 0; q < 4; q++) {
      const unpaidInInterval = L16[q]! + L17[q]!;
      if (unpaidInInterval > 0) {
        exactPenaltyCents += (unpaidInInterval * intervalDays[q]! * 7) / (365 * 100);
      }
    }
  }

  const L19 = l.set('f2210.19', roundToDollar(Math.round(exactPenaltyCents)), 'Form 2210 line 19 estimated tax penalty');
  const needsForm2210 = L19 > 0 && (Boolean(f.payments.computeForm2210) || boxes.length > 0);

  return {
    penalty: L19,
    needsForm2210,
    pages: [0, 1],
    printed,
  };
}
