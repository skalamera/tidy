import { roundToDollar, usd, type Cents } from '../engine/money';
import type { FilingStatus } from '../shared/facts';

export interface ReturnTranscriptData {
  taxYear: number | null;
  filingStatus: FilingStatus | null;
  /** Mapped Tidy ledger line IDs (e.g. `f1040.1z`, `f1040.11a`, `f1040.15`, `f1040.24`, `f1040.33`, `schD.21`, `schE.26`, `f8995.16`) to whole-dollar Cents.
   *  When both a reported line and a `PER COMPUTER` line exist in the transcript, the `PER COMPUTER` value wins. */
  lines: Record<string, Cents>;
  /** Raw normalized label -> Cents for every `LABEL: $amount` line in the transcript. */
  rawLines: Record<string, Cents>;
}

export interface AccountTranscriptTransaction {
  code: number;
  explanation: string;
  date: string | null;
  amount: Cents;
}

export interface AccountTranscriptData {
  taxYear: number | null;
  accountBalance: Cents | null;
  accruedInterest: Cents | null;
  accruedPenalty: Cents | null;
  returnDueDateOrReceivedDate: string | null;
  processingDate: string | null;
  /** Initial return summary figures at the top of the Account Transcript. */
  originalAgi: Cents | null;
  originalTaxableIncome: Cents | null;
  originalTaxPerReturn: Cents | null;
  seTaxableIncomeTaxpayer: Cents | null;
  seTaxableIncomeSpouse: Cents | null;
  totalPayments: Cents;
  /** True when transaction codes 971 ("Amended return filed") or 977 ("Amended return") appear. */
  wasAmended: boolean;
  /** True when post-filing assessment codes 290/291/300/301 appear with a non-zero tax change or after code 150. */
  wasAdjustedByIrs: boolean;
  /** Net change in assessed tax from codes 290, 291, 300, 301 after the original code 150 return settlement. */
  netTaxAdjustment: Cents;
  /** Authoritative total tax after applying any amended/IRS-adjusted tax changes (`code 150 + netTaxAdjustment`, or `originalTaxPerReturn + netTaxAdjustment`). */
  effectiveTotalTax: Cents | null;
  transactions: AccountTranscriptTransaction[];
}

/** Parse a dollar string like `$125,432.00`, `-$3,000.00`, `($1,250.00)`, or `$450.00-` into integer cents. */
export function parseTranscriptMoney(raw: string): Cents | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = s.startsWith('-') || s.startsWith('(') || s.endsWith('-');
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  return neg ? -cents : cents;
}

const normalizeLabel = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ,/()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const FILING_STATUS_MAP: Record<string, FilingStatus> = {
  SINGLE: 'single',
  'MARRIED FILING JOINT': 'mfj',
  'MARRIED FILING JOINTLY': 'mfj',
  'MARRIED FILING SEPARATE': 'mfs',
  'MARRIED FILING SEPARATELY': 'mfs',
  'HEAD OF HOUSEHOLD': 'hoh',
  'QUALIFYING SURVIVING SPOUSE': 'qss',
  'QUALIFYING WIDOW(ER)': 'qss',
};

/** Exact normalized IRS Return Transcript labels mapped to Tidy ledger line IDs.
 *  When a `PER COMPUTER` variant appears, it overwrites the taxpayer-reported variant so the IRS computer figure is authoritative. */
const RETURN_TRANSCRIPT_LINE_MAP: { pattern: RegExp; lineId: string; isPerComputer?: boolean }[] = [
  { pattern: /^WAGES, SALARIES, TIPS, ETC$/, lineId: 'f1040.1z' },
  { pattern: /^TAX-EXEMPT INTEREST$/, lineId: 'f1040.2a' },
  { pattern: /^TAXABLE INTEREST INCOME(?: SCH B)?$/, lineId: 'f1040.2b' },
  { pattern: /^QUALIFIED DIVIDENDS$/, lineId: 'f1040.3a' },
  { pattern: /^ORDINARY DIVIDEND INCOME(?: SCH B)?$/, lineId: 'f1040.3b' },
  { pattern: /^TOTAL IRA DISTRIBUTIONS$/, lineId: 'f1040.4a' },
  { pattern: /^TAXABLE IRA DISTRIBUTIONS$/, lineId: 'f1040.4b' },
  { pattern: /^TOTAL PENSIONS AND ANNUITIES$/, lineId: 'f1040.5a' },
  { pattern: /^TAXABLE PENSIONS AND ANNUITIES$/, lineId: 'f1040.5b' },
  { pattern: /^TOTAL SOCIAL SECURITY BENEFITS$/, lineId: 'f1040.6a' },
  { pattern: /^TAXABLE SOCIAL SECURITY BENEFITS$/, lineId: 'f1040.6b' },
  { pattern: /^TAXABLE SOCIAL SECURITY BENEFITS PER COMPUTER$/, lineId: 'f1040.6b', isPerComputer: true },
  { pattern: /^CAPITAL GAIN OR LOSS$/, lineId: 'f1040.7a' },
  { pattern: /^SCH D NET CAPITAL GAIN OR LOSS PER COMPUTER$/, lineId: 'f1040.7a', isPerComputer: true },
  { pattern: /^BUSINESS INCOME OR LOSS(?: \(SCH C\))?$/, lineId: 'sch1.3' },
  { pattern: /^OTHER GAINS OR LOSSES(?: \(FORM 4797\))?$/, lineId: 'sch1.4' },
  { pattern: /^RENT, ROYALTY, PARTNERSHIP, ESTATE(?:, TRUST, ETC)?(?: \(SCH E\))?$/, lineId: 'sch1.5' },
  { pattern: /^ADDITIONAL INCOME$/, lineId: 'f1040.8' },
  { pattern: /^ADDITIONAL INCOME PER COMPUTER$/, lineId: 'f1040.8', isPerComputer: true },
  { pattern: /^TOTAL INCOME$/, lineId: 'f1040.9' },
  { pattern: /^TOTAL INCOME PER COMPUTER$/, lineId: 'f1040.9', isPerComputer: true },
  { pattern: /^DEDUCTIBLE PART OF SELF-EMPLOYMENT TAX$/, lineId: 'sch1.15' },
  { pattern: /^SE DEDUCTION PER COMPUTER$/, lineId: 'sch1.15', isPerComputer: true },
  { pattern: /^SELF-EMPLOYED SEP, SIMPLE, AND QUALIFIED PLANS$/, lineId: 'sch1.16' },
  { pattern: /^SELF-EMPLOYED HEALTH INSURANCE DEDUCTION$/, lineId: 'sch1.17' },
  { pattern: /^TOTAL ADJUSTMENTS$/, lineId: 'f1040.10' },
  { pattern: /^TOTAL ADJUSTMENTS PER COMPUTER$/, lineId: 'f1040.10', isPerComputer: true },
  { pattern: /^ADJUSTED GROSS INCOME$/, lineId: 'f1040.11a' },
  { pattern: /^ADJUSTED GROSS INCOME PER COMPUTER$/, lineId: 'f1040.11a', isPerComputer: true },
  { pattern: /^STANDARD DEDUCTION$/, lineId: 'f1040.12e' },
  { pattern: /^STANDARD DEDUCTION PER COMPUTER$/, lineId: 'f1040.12e', isPerComputer: true },
  { pattern: /^TOTAL ITEMIZED DEDUCTIONS$/, lineId: 'schA.17' },
  { pattern: /^SCH A TOTAL ITEMIZED DEDUCTIONS PER COMPUTER$/, lineId: 'schA.17', isPerComputer: true },
  { pattern: /^QUALIFIED BUSINESS INCOME DEDUCTION$/, lineId: 'f1040.13a' },
  { pattern: /^QUALIFIED BUSINESS INCOME DEDUCTION COMPUTER$/, lineId: 'f1040.13a', isPerComputer: true },
  { pattern: /^ENHANCED SENIOR DEDUCTION$/, lineId: 'f1040.13b' },
  { pattern: /^TOTAL DEDUCTIONS$/, lineId: 'f1040.14' },
  { pattern: /^TOTAL DEDUCTIONS PER COMPUTER$/, lineId: 'f1040.14', isPerComputer: true },
  { pattern: /^TAXABLE INCOME$/, lineId: 'f1040.15' },
  { pattern: /^TAXABLE INCOME PER COMPUTER$/, lineId: 'f1040.15', isPerComputer: true },
  { pattern: /^TENTATIVE TAX$/, lineId: 'f1040.16' },
  { pattern: /^TENTATIVE TAX PER COMPUTER$/, lineId: 'f1040.16', isPerComputer: true },
  { pattern: /^ALTERNATIVE MINIMUM TAX$/, lineId: 'sch2.1' },
  { pattern: /^ALTERNATIVE MINIMUM TAX PER COMPUTER$/, lineId: 'sch2.1', isPerComputer: true },
  { pattern: /^TOTAL TAX BEFORE CREDITS$/, lineId: 'f1040.18' },
  { pattern: /^TOTAL TAX AFTER CREDITS$/, lineId: 'f1040.22' },
  { pattern: /^TOTAL TAX AFTER CREDITS PER COMPUTER$/, lineId: 'f1040.22', isPerComputer: true },
  { pattern: /^SE TAX$/, lineId: 'sch2.4' },
  { pattern: /^SE TAX PER COMPUTER$/, lineId: 'sch2.4', isPerComputer: true },
  { pattern: /^ADDITIONAL MEDICARE TAX$/, lineId: 'sch2.11' },
  { pattern: /^NET INVESTMENT INCOME TAX$/, lineId: 'sch2.12' },
  { pattern: /^NET INVESTMENT INCOME TAX PER COMPUTER$/, lineId: 'sch2.12', isPerComputer: true },
  { pattern: /^TOTAL OTHER TAXES$/, lineId: 'f1040.23' },
  { pattern: /^TOTAL OTHER TAXES PER COMPUTER$/, lineId: 'f1040.23', isPerComputer: true },
  { pattern: /^TOTAL TAX LIABILITY TP FIGURES$/, lineId: 'f1040.24' },
  { pattern: /^TOTAL TAX LIABILITY TP FIGURES PER COMPUTER$/, lineId: 'f1040.24', isPerComputer: true },
  { pattern: /^TOTAL ASSESSMENT PER COMPUTER$/, lineId: 'f1040.24', isPerComputer: true },
  { pattern: /^FEDERAL INCOME TAX WITHHELD$/, lineId: 'f1040.25d' },
  { pattern: /^ESTIMATED TAX PAYMENTS$/, lineId: 'f1040.26' },
  { pattern: /^AMOUNT PAID WITH FORM 4868$/, lineId: 'sch3.10' },
  { pattern: /^EXCESS SOCIAL SECURITY AND RRTA TAX WITHHELD$/, lineId: 'sch3.11' },
  { pattern: /^TOTAL PAYMENTS$/, lineId: 'f1040.33' },
  { pattern: /^TOTAL PAYMENTS PER COMPUTER$/, lineId: 'f1040.33', isPerComputer: true },
  { pattern: /^ESTIMATED TAX PENALTY$/, lineId: 'f1040.38' },
  { pattern: /^APPLIED TO NEXT YEAR.?S ESTIMATED TAX$/, lineId: 'f1040.36' },
  // Schedule A lines
  { pattern: /^MEDICAL AND DENTAL EXPENSES$/, lineId: 'schA.1' },
  { pattern: /^STATE AND LOCAL INCOME OR GENERAL SALES TAXES$/, lineId: 'schA.5a' },
  { pattern: /^STATE AND LOCAL REAL ESTATE TAXES$/, lineId: 'schA.5b' },
  { pattern: /^STATE AND LOCAL PERSONAL PROPERTY TAXES$/, lineId: 'schA.5c' },
  { pattern: /^TOTAL TAXES PAID$/, lineId: 'schA.5d' },
  { pattern: /^TOTAL STATE AND LOCAL TAXES DEDUCTION$/, lineId: 'schA.5e' },
  { pattern: /^HOME MORTGAGE INTEREST AND POINTS REPORTED ON FORM 1098$/, lineId: 'schA.8a' },
  { pattern: /^GIFTS BY CASH OR CHECK$/, lineId: 'schA.11' },
  { pattern: /^OTHER THAN BY CASH OR CHECK$/, lineId: 'schA.12' },
  { pattern: /^CARRYOVER FROM PRIOR YEAR$/, lineId: 'schA.13' },
  { pattern: /^TOTAL CHARITABLE CONTRIBUTIONS$/, lineId: 'schA.14' },
  // Schedule D lines
  { pattern: /^NET SHORT-TERM CAPITAL GAIN OR LOSS$/, lineId: 'schD.7' },
  { pattern: /^SHORT-TERM CAPITAL LOSS CARRYOVER$/, lineId: 'schD.6' },
  { pattern: /^NET LONG-TERM CAPITAL GAIN OR LOSS$/, lineId: 'schD.15' },
  { pattern: /^LONG-TERM CAPITAL LOSS CARRYOVER$/, lineId: 'schD.14' },
  { pattern: /^COMBINED NET CAPITAL GAIN OR LOSS$/, lineId: 'schD.16' },
];

/**
 * Deterministic plain-text parser for an IRS Tax Return Transcript (no AI).
 * Reads `LABEL: $amount` lines, prefers `PER COMPUTER` recalculations over taxpayer-reported figures,
 * and maps known lines to Tidy's ledger IDs.
 */
export function parseReturnTranscript(text: string): ReturnTranscriptData {
  let taxYear: number | null = null;
  let filingStatus: FilingStatus | null = null;
  const rawLines: Record<string, Cents> = {};
  const lines: Record<string, Cents> = {};
  const lockedByComputer = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Tax Period Ending: Dec. 31, 2024 or Tax Period Requested: December, 2024
    const yearMatch = /TAX PERIOD(?: ENDING| REQUESTED)?\s*:?\s*(?:[A-Za-z. ]+,\s*)?(20\d{2})/i.exec(line);
    if (yearMatch) {
      taxYear = Number.parseInt(yearMatch[1]!, 10);
      continue;
    }

    const fsMatch = /^FILING STATUS\s*:\s*(.+)$/i.exec(line);
    if (fsMatch) {
      const key = fsMatch[1]!.trim().toUpperCase();
      filingStatus = FILING_STATUS_MAP[key] ?? null;
      continue;
    }

    // Match `LABEL: $1,234.00` or `LABEL: -$1,234.00` or `LABEL: ($1,234.00)`
    const kv = /^([^:]+):\s*(-?\(?\$[0-9,]+(?:\.\d{2})?\)?-?)$/.exec(line);
    if (!kv) continue;

    const label = normalizeLabel(kv[1]!);
    const cents = parseTranscriptMoney(kv[2]!);
    if (cents === null) continue;

    const rounded = roundToDollar(cents);
    rawLines[label] = rounded;

    for (const m of RETURN_TRANSCRIPT_LINE_MAP) {
      if (m.pattern.test(label)) {
        if (m.isPerComputer) {
          lines[m.lineId] = rounded;
          lockedByComputer.add(m.lineId);
        } else if (!lockedByComputer.has(m.lineId)) {
          lines[m.lineId] = rounded;
        }
      }
    }
  }

  return { taxYear, filingStatus, lines, rawLines };
}

/**
 * Deterministic plain-text parser for an IRS Account Transcript (no AI).
 * Detects amended returns (codes 971 / 977) and IRS tax adjustments (codes 290 / 291 / 300 / 301),
 * and computes the authoritative post-amendment / post-adjustment tax liability.
 */
export function parseAccountTranscript(text: string): AccountTranscriptData {
  let taxYear: number | null = null;
  let accountBalance: Cents | null = null;
  let accruedInterest: Cents | null = null;
  let accruedPenalty: Cents | null = null;
  let returnDueDateOrReceivedDate: string | null = null;
  let processingDate: string | null = null;
  let originalAgi: Cents | null = null;
  let originalTaxableIncome: Cents | null = null;
  let originalTaxPerReturn: Cents | null = null;
  let seTaxableIncomeTaxpayer: Cents | null = null;
  let seTaxableIncomeSpouse: Cents | null = null;

  const transactions: AccountTranscriptTransaction[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const yearMatch = /TAX PERIOD(?: REQUESTED| ENDING)?\s*:?\s*(?:[A-Za-z. ]+,\s*)?(20\d{2})/i.exec(line);
    if (yearMatch) {
      taxYear = Number.parseInt(yearMatch[1]!, 10);
      continue;
    }

    const kv = /^([^:]+):\s*(.+)$/.exec(line);
    if (kv) {
      const k = normalizeLabel(kv[1]!);
      const v = kv[2]!.trim();
      const money = parseTranscriptMoney(v);
      if (k === 'ACCOUNT BALANCE' && money !== null) accountBalance = money;
      else if (k === 'ACCRUED INTEREST' && money !== null) accruedInterest = money;
      else if (k === 'ACCRUED PENALTY' && money !== null) accruedPenalty = money;
      else if (k.startsWith('RETURN DUE DATE')) returnDueDateOrReceivedDate = v;
      else if (k === 'PROCESSING DATE') processingDate = v;
      else if (k === 'ADJUSTED GROSS INCOME' && money !== null) originalAgi = roundToDollar(money);
      else if (k === 'TAXABLE INCOME' && money !== null) originalTaxableIncome = roundToDollar(money);
      else if (k === 'TAX PER RETURN' && money !== null) originalTaxPerReturn = roundToDollar(money);
      else if (k === 'SE TAXABLE INCOME TAXPAYER' && money !== null) seTaxableIncomeTaxpayer = roundToDollar(money);
      else if (k === 'SE TAXABLE INCOME SPOUSE' && money !== null) seTaxableIncomeSpouse = roundToDollar(money);
    }

    // Transaction line format: `150  Tax return filed  20231505  04-15-2023  $42,150.00` or `971  Amended return filed  09-18-2023  $0.00`
    const txMatch = /^(\d{3})\s+(.+?)\s+(?:(\d{2}-\d{2}-\d{4})\s+)?(-?\(?\$[0-9,]+(?:\.\d{2})?\)?-?)$/.exec(line);
    if (txMatch) {
      const code = Number.parseInt(txMatch[1]!, 10);
      const explanation = txMatch[2]!.replace(/\s+\d{8}$/, '').trim();
      const date = txMatch[3] ?? null;
      const amount = parseTranscriptMoney(txMatch[4]!) ?? 0;
      transactions.push({ code, explanation, date, amount });
    }
  }

  const code150 = transactions.find((t) => t.code === 150);
  const wasAmended = transactions.some((t) => t.code === 977 || (t.code === 971 && /amended|1040-?x/i.test(t.explanation)));

  // Additional tax assessed (290, 300) or abated/reduced (291, 301)
  const adjustmentTxs = transactions.filter((t) => t.code === 290 || t.code === 291 || t.code === 300 || t.code === 301);
  let netTaxAdjustment = 0;
  for (const t of adjustmentTxs) {
    if (t.code === 291 || t.code === 301) {
      netTaxAdjustment -= Math.abs(roundToDollar(t.amount));
    } else {
      netTaxAdjustment += roundToDollar(t.amount);
    }
  }

  const wasAdjustedByIrs = adjustmentTxs.some((t) => t.amount !== 0) || adjustmentTxs.some((t) => t.code === 300 || t.code === 301);

  // Sum withholding (806), estimated/credit elect payments (660, 710, 716), and subsequent payments (670)
  let totalPayments = 0;
  for (const t of transactions) {
    if (t.code === 806 || t.code === 660 || t.code === 710 || t.code === 716 || t.code === 670) {
      totalPayments += Math.abs(roundToDollar(t.amount));
    }
  }

  const baseTax = code150 ? roundToDollar(code150.amount) : originalTaxPerReturn;
  const effectiveTotalTax = baseTax !== null ? Math.max(usd(0), baseTax + netTaxAdjustment) : null;

  return {
    taxYear,
    accountBalance,
    accruedInterest,
    accruedPenalty,
    returnDueDateOrReceivedDate,
    processingDate,
    originalAgi,
    originalTaxableIncome,
    originalTaxPerReturn,
    seTaxableIncomeTaxpayer,
    seTaxableIncomeSpouse,
    totalPayments,
    wasAmended,
    wasAdjustedByIrs,
    netTaxAdjustment,
    effectiveTotalTax,
    transactions,
  };
}
