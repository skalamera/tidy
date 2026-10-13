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
  itemized: ItemizedInputs;
  /** Itemize even if smaller than the standard deduction (rare; needed for some state reasons). */
  forceItemize: boolean;
  payments: Payments;
  foreignAccounts: { hasForeignAccount: boolean | null; fbarRequired: boolean | null; countries: string[]; foreignTrust: boolean | null };
  stateReturn: StateReturnFacts;
}
