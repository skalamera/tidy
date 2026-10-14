import type { Cents } from '../engine/money';
import type { MdCounty } from '../engine/params/md2025';

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh' | 'qss';
export type Owner = 'taxpayer' | 'spouse';
export type StateCode = 'MD';

/** Where a number came from. `verified` = the quote was found on that page of the document text. */
export interface Evidence {
  docId: string;
  page: number | null;
  quote: string | null;
  verified: boolean;
}

export interface Person {
  firstName: string;
  lastName: string;
  /** 9 digits, no dashes. Stored encrypted; masked in the UI. */
  ssn: string;
  dateOfBirth: string | null; // YYYY-MM-DD
  blind?: boolean;
  totallyDisabled?: boolean;
}

export interface Address {
  street: string;
  apt: string | null;
  city: string;
  state: string;
  zip: string;
}

export interface W2 {
  id: string;
  owner: Owner;
  employerName: string;
  employerEin: string | null;
  employerAddress: { street: string; city: string; state: string; zip: string } | null;
  retirementPlan: boolean; // box 13
  box14: { description: string; amount: Cents }[];
  box1Wages: Cents;
  box2FedWithheld: Cents;
  box3SsWages: Cents;
  box4SsWithheld: Cents;
  box5MedicareWages: Cents;
  box6MedicareWithheld: Cents;
  box12: { code: string; amount: Cents }[];
  stateLines: { state: string; stateWages: Cents; stateTax: Cents }[]; // boxes 15–17 (one row per state)
  localLines: { locality: string; localWages: Cents; localTax: Cents }[]; // boxes 18–20
  evidence: Record<string, Evidence>;
}

export interface Form1099Int {
  id: string;
  owner: Owner;
  payerName: string;
  box1Interest: Cents;
  box3UsTreasuryInterest: Cents;
  box4FedWithheld: Cents;
  box6ForeignTaxPaid: Cents;
  box8TaxExemptInterest: Cents;
  box9PrivateActivityBondInterest: Cents;
  evidence: Record<string, Evidence>;
}

export interface Form1099Div {
  id: string;
  owner: Owner;
  payerName: string;
  box1aOrdinaryDividends: Cents;
  box1bQualifiedDividends: Cents;
  box2aCapitalGainDistributions: Cents;
  box2bUnrecaptured1250Gain: Cents;
  box2d28RateGain: Cents;
  box4FedWithheld: Cents;
  box5Section199aDividends: Cents;
  box7ForeignTaxPaid: Cents;
  box12ExemptInterestDividends: Cents;
  box13PrivateActivityBondDividends: Cents;
  evidence: Record<string, Evidence>;
}

/** Maryland Form 502R Part 4 source classification for a Form 1099-R pension/annuity. */
export type Md502RSource = 'qualified_plan' | 'military' | 'public_safety' | 'other';

export interface Form1099R {
  id: string;
  owner: Owner;
  payerName: string;
  payerEin: string | null;
  box1GrossDistribution: Cents;
  box2aTaxableAmount: Cents;
  box2bTaxableNotDetermined: boolean;
  box2bTotalDistribution: boolean;
  box4FedWithheld: Cents;
  box5EmployeeContributions: Cents;
  /** Uppercase distribution code(s) from box 7, e.g. "7", "G", "7B", "1". */
  box7Codes: string;
  /** Box 7 IRA/SEP/SIMPLE checkbox. True = IRA/SEP/SIMPLE (Form 1040 line 4a/4b); false = pension/annuity (line 5a/5b). */
  iraSepSimple: boolean;
  stateLines: { state: string; stateTax: Cents; stateDistribution: Cents }[];
  /** Portion of box 1 rolled over to another retirement account (if not already code G/H with box 2a = 0). */
  rolloverAmount?: Cents;
  /** Qualified charitable distribution (QCD) from an IRA (excluded from taxable amount on line 4b with QCD checked). */
  qcdAmount?: Cents;
  /** Eligible retired public safety officer insurance premiums (up to $3,000, excluded on line 5b with PSO checked). */
  psoAmount?: Cents;
  /** Maryland Form 502R Part 4 source category (for non-IRA pensions). Defaults to 'qualified_plan' when not specified. */
  mdSource?: Md502RSource;
  evidence: Record<string, Evidence>;
}

export interface Ssa1099 {
  id: string;
  owner: Owner;
  /** Box 3: Benefits paid in 2025. */
  box3BenefitsPaid: Cents;
  /** Box 4: Benefits repaid to SSA in 2025. */
  box4BenefitsRepaid: Cents;
  /** Box 5: Net benefits for 2025 (box 3 minus box 4; can be negative if repayments exceeded benefits). */
  box5NetBenefits: Cents;
  /** Box 6: Voluntary federal income tax withheld. */
  box6FedWithheld: Cents;
  evidence: Record<string, Evidence>;
}

/** Form 8949 / 1099-B reporting category:
 *  A/D = short/long-term with basis reported to the IRS (covered);
 *  B/E = short/long-term with basis NOT reported to the IRS (noncovered);
 *  C/F = short/long-term not reported on Form 1099-B. */
export type Form8949Box = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface CapitalLot {
  description: string;
  /** Date acquired (MM/DD/YYYY or "VARIOUS"). */
  dateAcquired: string | null;
  /** Date sold or disposed of (MM/DD/YYYY). */
  dateSold: string | null;
  /** Box 1d: Proceeds (sales price). */
  proceeds: Cents;
  /** Box 1e: Cost or other basis. */
  costBasis: Cents;
  /** Box 1f: Accrued market discount. */
  marketDiscount: Cents;
  /** Box 1g: Wash sale loss disallowed. */
  washSaleDisallowed: Cents;
  /** Form 8949 box (A/B/C short-term, D/E/F long-term). */
  box: Form8949Box;
  /** Optional explicit Form 8949 column (f) code(s), e.g. "W", "B", "M". Inferred automatically for wash sales / market discount when omitted. */
  adjustmentCode?: string;
  /** Optional explicit Form 8949 column (g) adjustment in cents (signed). Inferred from washSaleDisallowed - marketDiscount when omitted. */
  adjustmentAmount?: Cents;
  /** True if box 2 "Collectibles" is checked on Form 1099-B (28% rate gain/loss). */
  collectibles?: boolean;
}

export interface Form1099B {
  id: string;
  owner: Owner;
  payerName: string;
  box4FedWithheld: Cents;
  lots: CapitalLot[];
  evidence: Record<string, Evidence>;
}

export interface Carryovers {
  /** Positive magnitude of short-term capital loss carryover from 2024 to 2025 (Schedule D line 6). */
  capitalLossShortTerm: Cents;
  /** Positive magnitude of long-term capital loss carryover from 2024 to 2025 (Schedule D line 14). */
  capitalLossLongTerm: Cents;
  /** Positive magnitude of qualified business net loss carryforward from 2024 (Form 8995 line 3). */
  qbiLoss: Cents;
  /** Positive magnitude of qualified REIT dividends / PTP loss carryforward from 2024 (Form 8995 line 7 / 8995-A line 29). */
  reitPtpLoss: Cents;
}

export interface ItemizedInputs {
  medicalExpenses: Cents;
  /** State/local income tax PAID during the calendar year beyond W-2 withholding: estimated payments
   *  (including the January payment for last year), last year's balance due paid this year, etc. */
  stateIncomeTaxPayments: { label: string; amount: Cents }[];
  realEstateTax: Cents;
  personalPropertyTax: Cents;
  mortgageInterest1098: Cents;
  investmentInterest: Cents;
  charityCash: Cents;
  charityNonCash: Cents;
  charityCarryover: Cents;
}

export interface Payments {
  /** Federal estimated payments made for this tax year (include the January payment of the next year). */
  federalEstimated: Cents[];
  /** Overpayment from last year's return applied to this year (prior-year Form 1040 line 36). */
  federalPriorYearApplied: Cents;
  /** Amount paid with Form 4868 extension request. */
  federalExtensionPayment: Cents;
}

/** Inputs that only the state return needs. */
export interface StateReturnFacts {
  /** Part of tax-exempt interest (1099-INT box 8 + 1099-DIV box 12) from bonds of YOUR state. null = not answered yet. */
  homeStateMuniInterest: Cents | null;
  /** 2025 estimated payments to Maryland, including the one paid in January 2026. */
  estimatedPayments: Cents[];
  /** Overpayment from your 2024 state return applied to 2025. */
  priorYearApplied: Cents;
  /** Paid with a Maryland extension request (Form 502E). */
  extensionPayment: Cents;
}

export interface TaxFacts {
  taxYear: 2025;
  filingStatus: FilingStatus;
  taxpayer: Person;
  spouse: Person | null;
  address: Address;
  residency: {
    state: StateCode | null;
    fullYear: boolean | null;
    mdCounty: MdCounty | null;
    /** MD: 4-digit political subdivision (Form 502 page 1). */
    mdSubdivision: { code: string; name: string } | null;
  };
  digitalAssets: boolean | null;
  w2s: W2[];
  f1099Int: Form1099Int[];
  f1099Div: Form1099Div[];
  f1099B?: Form1099B[];
  f1099R?: Form1099R[];
  ssa1099?: Ssa1099[];
  carryovers?: Carryovers;
  /** True if taxpayer or spouse has nondeductible traditional IRA basis (requires Form 8606 on traditional IRA distributions). */
  hasNondeductibleIraBasis?: boolean | null;
  itemized: ItemizedInputs;
  /** Itemize even if smaller than the standard deduction (rare; needed for some state reasons). */
  forceItemize: boolean;
  payments: Payments;
  foreignAccounts: { hasForeignAccount: boolean | null; fbarRequired: boolean | null; countries: string[]; foreignTrust: boolean | null };
  stateReturn: StateReturnFacts;
}
