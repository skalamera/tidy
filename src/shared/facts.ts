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

export interface Form1099Nec {
  id: string;
  owner: Owner;
  payerName: string;
  payerEin: string | null;
  /** Box 1: Nonemployee compensation. */
  box1NonemployeeCompensation: Cents;
  /** Box 4: Federal income tax withheld. */
  box4FedWithheld: Cents;
  stateLines: { state: string; stateTax: Cents; stateIncome: Cents }[];
  evidence: Record<string, Evidence>;
}

/** Expenses for business use of home (Schedule C line 30 / Form 8829). */
export interface HomeOfficeFacts {
  method: 'simplified' | 'regular';
  /** Area of home used regularly and exclusively for business (Form 8829 line 1 / simplified line 30(b)). */
  businessSqFt: number;
  /** Total area of home (Form 8829 line 2 / simplified line 30(a)). */
  totalSqFt: number;
  /** Form 8829 Part II direct expenses (lines 9a–11a, 16a–22a). */
  directMortgageInterest?: Cents;
  directRealEstateTaxes?: Cents;
  directInsurance?: Cents;
  directRent?: Cents;
  directRepairs?: Cents;
  directUtilities?: Cents;
  directOther?: Cents;
  /** Form 8829 Part II indirect expenses (lines 9b–11b, 16b–22b). When mortgageInterest / realEstateTaxes are omitted, defaults to itemized inputs. */
  indirectMortgageInterest?: Cents;
  indirectRealEstateTaxes?: Cents;
  indirectInsurance?: Cents;
  indirectRent?: Cents;
  indirectRepairs?: Cents;
  indirectUtilities?: Cents;
  indirectOther?: Cents;
  /** Prior-year unallowed operating expenses carryover (Form 8829 line 25). */
  priorOperatingCarryover?: Cents;
  /** Prior-year unallowed excess casualty losses and depreciation carryover (Form 8829 line 31). */
  priorDepreciationCarryover?: Cents;
  /** Form 8829 Part III — Depreciation of your home (lines 37–41). */
  homeAdjustedBasisOrFmv?: Cents;
  homeLandValue?: Cents;
  /** Depreciation percentage in ppm (e.g. 2.564% = pct('2.564')), or standard 39-year nonresidential (2.564%) if omitted. */
  homeDepreciationRatePpm?: number;
}

/** Business asset on the depreciation listing and its 2025 disposition (sold, scrapped/abandoned, or converted to personal use). */
export interface BusinessAssetDisposition {
  description: string;
  /** Date acquired (MM/DD/YYYY). */
  dateAcquired: string;
  /** Date sold, scrapped, or converted to personal use (MM/DD/YYYY). */
  dateDisposed: string;
  /** How the asset left the business:
   *  - 'sold': sold for `salesPrice` -> reported on Form 4797 (Part III if held >1 yr with gain and depreciation, Part I if held >1 yr with loss, Part II if held <=1 yr).
   *  - 'scrapped': abandoned / thrown away for $0 -> ordinary abandonment loss of remaining adjusted basis on Form 4797 Part II line 10.
   *  - 'personal': kept for personal use -> no gain or loss recognized unless business use of §179 / listed property dropped to <=50% during recovery period (Form 4797 Part IV). */
  disposition: 'sold' | 'scrapped' | 'personal';
  /** Gross sales price (Form 4797 line 2(d) / 10(d) / 20). 0 if scrapped or converted to personal use. */
  salesPrice: Cents;
  /** Cost or other basis plus improvements and expense of sale (Form 4797 line 2(f) / 10(f) / 21). */
  costBasis: Cents;
  /** Total depreciation (including §179 and bonus) allowed or allowable since acquisition (Form 4797 line 2(e) / 10(e) / 22). */
  depreciationAllowed: Cents;
  /** True if held more than 1 year (default true). */
  heldMoreThanOneYear?: boolean;
  /** Property type for Form 4797 Part III recapture (default '1245' for equipment/furniture/computers). */
  propertyType?: '1245' | '1250';
  /** Prior-year §179 deduction subject to recapture on conversion to <=50% business use (Form 4797 Part IV line 33(a)). */
  section179RecapturePrior?: Cents;
  /** Recomputed depreciation had §179 not been claimed (Form 4797 Part IV line 34(a)). */
  section179RecomputedDepreciation?: Cents;
}

/** Sole proprietorship business (Schedule C, Schedule SE, SEP deduction, Form 7206, Form 8829, Form 4797). */
export interface ScheduleCBusiness {
  id: string;
  owner: Owner;
  /** Line A: Principal business or profession, e.g. "Management consulting". */
  principalBusiness: string;
  /** Line B: 6-digit Principal Business Code from instructions, e.g. "541610". */
  businessCode: string;
  /** Line C: Business name (blank if same as proprietor). */
  businessName?: string | null;
  /** Line D: EIN (9 digits, no dashes) if any. */
  ein?: string | null;
  /** True if the business is a Specified Service Trade or Business (SSTB) under IRC §199A(d)(2) (e.g. consulting, law, health, accounting). */
  isSstb?: boolean;
  /** True if this business closed in 2024 (no 2025 Schedule C needed). */
  closedInPriorYear?: boolean;
  /** Gross receipts or sales in addition to any uploaded Form 1099-NECs for this owner. */
  additionalGrossReceipts?: Cents;
  returnsAndAllowances?: Cents;
  otherIncome?: Cents;
  /** Schedule C Part II expenses (lines 8–27a). */
  expenses: {
    advertising?: Cents; // line 8
    carAndTruck?: Cents; // line 9
    commissionsAndFees?: Cents; // line 10
    contractLabor?: Cents; // line 11
    depletion?: Cents; // line 12
    depreciation?: Cents; // line 13
    employeeBenefitPrograms?: Cents; // line 14
    insurance?: Cents; // line 15
    interestMortgage?: Cents; // line 16a
    interestOther?: Cents; // line 16b
    legalAndProfessional?: Cents; // line 17
    officeExpense?: Cents; // line 18
    pensionAndProfitSharing?: Cents; // line 19 (for employees)
    rentVehiclesMachinery?: Cents; // line 20a
    rentOtherBusinessProperty?: Cents; // line 20b
    repairsAndMaintenance?: Cents; // line 21
    supplies?: Cents; // line 22
    taxesAndLicenses?: Cents; // line 23
    travel?: Cents; // line 24a
    deductibleMeals?: Cents; // line 24b (50% limit already applied)
    utilities?: Cents; // line 25
    wages?: Cents; // line 26
  };
  /** Schedule C Part V (line 48 -> line 27b) other expenses. */
  otherExpenses?: { description: string; amount: Cents }[];
  /** Home office (Schedule C line 30 / Form 8829). */
  homeOffice?: HomeOfficeFacts | null;
  /** Self-employed SEP, SIMPLE, or solo 401(k) employer contribution for the proprietor (Schedule 1 line 16).
   *  When `'max'`, Tidy computes the maximum deductible 20% (25% / 1.25) SEP contribution up to $70,000. */
  sepContribution?: Cents | 'max';
  /** Health insurance premiums paid in 2025 under the business for months not eligible for an employer plan (Form 7206 line 1). */
  healthInsurancePremiums?: Cents;
  /** Qualified long-term care insurance premiums paid in 2025 (Form 7206 line 2, capped by age limit in engine). */
  longTermCarePremiums?: Cents;
  /** Dispositions of business assets in 2025 (Form 4797). */
  assetDispositions?: BusinessAssetDisposition[];
  /** Nonrecaptured net §1231 losses from prior 5 years (Form 4797 line 8). */
  priorSection1231Losses?: Cents;
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
  f1099Nec?: Form1099Nec[];
  ssa1099?: Ssa1099[];
  scheduleC?: ScheduleCBusiness[];
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
