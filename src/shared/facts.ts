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
  /** Box 2a was left blank (not printed as 0.00). */
  box2aBlank?: boolean;
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
  /** Medicare premiums deducted from the benefits (only suggests the medical question's answer). */
  medicarePremiums?: Cents;
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

/** Form 1099-G (Certain Government Payments). */
export interface Form1099G {
  id: string;
  owner: Owner;
  payerName: string;
  box1Unemployment: Cents;
  box2StateRefund: Cents;
  /** Box 3: the tax year box 2's refund is for. */
  box3TaxYear: number | null;
  box4FedWithheld: Cents;
  /** Boxes 5, 6, 7 and 9 together (not supported yet: they block). */
  otherBoxes?: Cents;
  stateLines: { state: string | null; stateTax: Cents }[];
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
  /** Positive magnitude of charitable contribution carryover from 2024 (Schedule A line 13). */
  charitable?: Cents;
  /** Positive magnitude of total unallowed passive activity loss carryover from 2024 (Form 8582). */
  passiveLoss?: Cents;
  /** Positive magnitude of prior-year minimum tax credit carryover from 2024 (Form 8801). */
  amtCredit?: Cents;
  /** Positive magnitude of foreign tax credit carryover from 2024 (Form 1116 Schedule B). */
  foreignTaxCredit?: Cents;
  /** Positive magnitude of disallowed investment interest expense carryover from 2024 (Form 4952 line 2). */
  investmentInterest?: Cents;
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
  /** Schedule C line G: materially participated in 2025. */
  materialParticipation?: boolean;
  /** UBIA of qualified property (Form 8995-A line 7): original cost of business property still in its depreciable period. */
  ubiaOfQualifiedProperty?: Cents;
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

/** Depreciable rental asset for Schedule E line 18 / Form 4562. */
export interface RentalDepreciableAsset {
  description: string;
  /** Month and year placed in service (MM/YYYY), e.g. "06/2025" or "03/2021". */
  placedInService: string;
  /** Depreciable basis (excluding land). */
  basis: Cents;
  /** Recovery period in years (27.5 for residential rental real estate, 39 for commercial, 5/7/15 for appliances/improvements). */
  recoveryPeriodYears?: number;
  /** True if placed in service during 2025 (requires Form 4562 Part III Section B). */
  placedInServiceIn2025?: boolean;
  /** Optional explicit 2025 depreciation deduction in cents (when omitted, Tidy computes straight-line MACRS). */
  currentYearDepreciation?: Cents;
  /** Optional Maryland depreciation deduction without federal bonus/§179 decoupling (for Form 500DM). */
  mdDepreciationWithoutDecoupling?: Cents;
}

/** Rental real estate or royalty property reported on Schedule E Part I (columns A, B, C). */
export interface RentalProperty {
  id: string;
  owner: Owner;
  /** Line 1a: Physical address (street, city, state, ZIP). */
  address: string;
  /** Line 1b: Property type code 1–8 (1=Single Family, 2=Multi-Family, 3=Vacation/Short-Term, 4=Commercial, 5=Land, 6=Royalties, 7=Self-Rental, 8=Other). */
  propertyType: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  otherPropertyTypeDescription?: string;
  /** Line 2: Fair rental days during 2025. */
  fairRentalDays: number;
  /** Line 2: Personal use days during 2025. */
  personalUseDays: number;
  /** Line 2: Qualified Joint Venture checkbox. */
  qjv?: boolean;
  /** Active participation for the $25,000 special rental real estate loss allowance on Form 8582 Part I/II (default true for rental real estate). */
  activeParticipation?: boolean;
  /** Qualifies as a §199A trade or business for QBI on Form 8995 / 8995-A (default false unless specified). */
  qualifiesForQbi?: boolean;
  /** Prior-year unallowed passive loss carryover for this property (Form 8582 Part IV col (c), positive magnitude). */
  priorUnallowedPassiveLoss?: Cents;
  /** Line 3: Rents received. */
  rentsReceived: Cents;
  /** Line 4: Royalties received. */
  royaltiesReceived?: Cents;
  /** Lines 5–19: Rental expenses. */
  expenses: {
    advertising?: Cents; // line 5
    autoAndTravel?: Cents; // line 6
    cleaningAndMaintenance?: Cents; // line 7
    commissions?: Cents; // line 8
    insurance?: Cents; // line 9
    legalAndProfessional?: Cents; // line 10
    managementFees?: Cents; // line 11
    mortgageInterest?: Cents; // line 12
    otherInterest?: Cents; // line 13
    repairs?: Cents; // line 14
    supplies?: Cents; // line 15
    taxes?: Cents; // line 16
    utilities?: Cents; // line 17
    depreciation?: Cents; // line 18 (added to any computed asset depreciation)
    other?: Cents; // line 19
    otherDescription?: string;
  };
  /** Depreciable assets (buildings/improvements) for this property. */
  depreciableAssets?: RentalDepreciableAsset[];
}

/** Schedule K-1 from a Partnership (Form 1065), S Corporation (Form 1120-S), or Estate/Trust (Form 1041). */
export interface ScheduleK1 {
  id: string;
  owner: Owner;
  /** Entity type: '1065' = Partnership, '1120S' = S Corporation, '1041' = Estate or Trust. */
  entityType: '1065' | '1120S' | '1041';
  entityName: string;
  entityEin: string;
  isForeignPartnership?: boolean;
  /** True if the taxpayer materially participated in the trade/business (nonpassive) vs passive activity (default false = passive for box 1). */
  isMaterialParticipation?: boolean;
  /** True if active participation in rental real estate (box 2) for Form 8582 $25k allowance (default false for K-1 unless checked). */
  activeRentalParticipation?: boolean;
  /** Prior-year unallowed passive loss carryover for this K-1 activity (Form 8582 Part IV/V col (c), positive magnitude). */
  priorUnallowedPassiveLoss?: Cents;
  /** Box 1: Ordinary business income (loss) (1065 box 1 / 1120-S box 1). Signed cents. */
  ordinaryBusinessIncome: Cents;
  /** Box 2: Net rental real estate income (loss) (1065 box 2 / 1120-S box 2 / 1041 box 7). Signed cents. */
  netRentalRealEstateIncome: Cents;
  /** Box 3: Other net rental income (loss). Signed cents. */
  otherNetRentalIncome?: Cents;
  /** Guaranteed payments for services or capital (1065 box 4c). Always nonpassive income on Schedule E Part II col (k). */
  guaranteedPayments?: Cents;
  /** Interest income (1065 box 5 / 1120-S box 4 / 1041 box 1) -> Schedule B Part I. */
  interestIncome: Cents;
  /** Ordinary dividends (1065 box 6a / 1120-S box 5a / 1041 box 2a) -> Schedule B Part II. */
  ordinaryDividends: Cents;
  /** Qualified dividends (1065 box 6b / 1120-S box 5b / 1041 box 2b) -> Form 1040 line 3a. */
  qualifiedDividends: Cents;
  /** Royalties (1065 box 7 / 1120-S box 6) -> Schedule E Part I. */
  royalties?: Cents;
  /** Net short-term capital gain (loss) (1065 box 8 / 1120-S box 7 / 1041 box 3) -> Schedule D line 5. Signed cents. */
  netShortTermCapitalGain: Cents;
  /** Net long-term capital gain (loss) (1065 box 9a / 1120-S box 8a / 1041 box 4a) -> Schedule D line 12. Signed cents. */
  netLongTermCapitalGain: Cents;
  /** Collectibles (28%) gain (loss) (1065 box 9b / 1120-S box 8b / 1041 box 4b) -> Schedule D line 18 worksheet. Signed cents. */
  collectibles28Gain?: Cents;
  /** Unrecaptured Section 1250 gain (1065 box 9c / 1120-S box 8c / 1041 box 4c) -> Schedule D line 19 worksheet. */
  unrecaptured1250Gain?: Cents;
  /** Net Section 1231 gain (loss) (1065 box 10 / 1120-S box 9) -> Form 4797 Part I line 2. Signed cents. */
  netSection1231Gain: Cents;
  /** Section 179 deduction (1065 box 12 / 1120-S box 11) -> Schedule E Part II col (j) / Form 4562. */
  section179Deduction?: Cents;
  /** Self-employment net earnings (loss) (1065 box 14 code A) -> Schedule SE line 2. Signed cents. */
  selfEmploymentEarnings?: Cents;
  /** Section 199A Qualified Business Income (1065 box 20 code Z / 1120-S box 17 code V / 1041 box 14 code I). Signed cents. */
  qbiAmount?: Cents;
  /** Section 199A W-2 wages from the pass-through entity (Form 8995-A Schedule A / Part II). */
  qbiW2Wages?: Cents;
  /** Section 199A UBIA of qualified property from the pass-through entity. */
  qbiUbia?: Cents;
  /** Section 199A qualified REIT dividends from the pass-through entity (Form 8995 line 6 / 8995-A line 28). */
  qbiReitDividends?: Cents;
  /** True if the K-1 activity is an SSTB for §199A. */
  isSstb?: boolean;
  /** For 1041 Estate/Trust K-1s: Box 5 other portfolio and nonbusiness income, Box 6 ordinary business income, Box 8 other rental income. */
  trustOtherIncome?: Cents;
  /** S Corporation shareholder basis tracking (Form 7203, for entityType === '1120S'): */
  sCorpBasis?: {
    /** Line 1: Stock basis at the beginning of the tax year. */
    beginningStockBasis: Cents;
    /** Line 2: Capital contributions or additional stock acquired during the year. */
    capitalContributions?: Cents;
    /** Line 6: Distributions (1120-S box 16 code D). */
    distributions?: Cents;
    /** Line 8a: Nondeductible expenses (1120-S box 16 code C). */
    nondeductibleExpenses?: Cents;
    /** Line 16: Shareholder loan balance to S-corp at beginning of year. */
    beginningLoanBalance?: Cents;
    /** Line 21: Debt basis at beginning of year (defaults to beginningLoanBalance). */
    beginningDebtBasis?: Cents;
    /** Line 17: Additional loans made to S-corp during the year. */
    additionalLoans?: Cents;
    /** Line 19: Principal portion of debt repayment received during the year. */
    debtRepayment?: Cents;
    /** Prior-year carryover of disallowed ordinary loss due to basis (Form 7203 line 35 col (b)). */
    priorDisallowedOrdinaryLoss?: Cents;
  };
  /** Maryland Form 500DM / 510 / 511 K-1 decoupling modification (positive = addition to MD income, negative = subtraction). */
  mdDecouplingModification?: Cents;
  /** AMT items (1065 box 17 / 1120-S box 15): code A post-1986 depreciation adjustment -> Form 6251 line 2l. Signed. */
  amtDepreciationAdjustment?: Cents;
  /** Code B adjusted gain or loss -> Form 6251 line 2k. Signed. */
  amtGainLossAdjustment?: Cents;
  /** Codes C–F (depletion, oil and gas, other) -> Form 6251 line 3. Signed. */
  amtOtherAdjustments?: Cents;
  /** Form 1041 K-1 box 12 code A (adjustment for minimum tax purposes) -> Form 6251 line 2j. Signed. */
  amtEstateTrustAdjustment?: Cents;
  evidence?: Record<string, Evidence>;
}

/** Maryland Form 500DM decoupling inputs (when federal return uses bonus depreciation, §179 > $25k, etc.). */
export interface MdDecouplingFacts {
  /** Line 1 Col 1: Federal depreciation deduction as filed. */
  federalDepreciation: Cents;
  /** Line 1 Col 2: Federal depreciation recomputed without decoupled provisions (bonus depreciation, §179 > $25k). */
  mdDepreciationWithoutDecoupling: Cents;
  /** Line 9 Col 3: Net decoupling modification from pass-through entities (signed). */
  pteDecouplingModification?: Cents;
}

export interface ItemizedInputs {
  medicalExpenses: Cents;
  /** Qualified long-term care insurance premiums each person paid (Schedule A counts them up to an age limit). */
  longTermCarePremiums?: { taxpayer: Cents; spouse: Cents };
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
  /** Optional dated federal estimated payments (`YYYY-MM-DD`) for Form 2210 daily penalty calculation. */
  federalEstimatedDated?: { datePaid: string; amount: Cents }[];
  /** Estimated payments that count toward each 2025 installment (paid on or before its due date and after the one
   *  before). Payments after January 15, 2026 are in `federalEstimated` only. Preferred over the dated list. */
  federalEstimatedByQuarter?: [Cents, Cents, Cents, Cents];
  /** Overpayment from last year's return applied to this year (prior-year Form 1040 line 36). */
  federalPriorYearApplied: Cents;
  /** Amount paid with Form 4868 extension request. */
  federalExtensionPayment: Cents;
  /** Prior-year (2024) federal AGI (Form 1040 line 11) for Form 2210 line 8 100% vs 110% safe harbor. */
  priorYearFederalAgi?: Cents | null;
  /** Prior-year (2024) federal total tax (Form 1040 line 24 less refundable credits) for Form 2210 line 8 safe harbor. */
  priorYearFederalTax?: Cents | null;
  /** True to compute the Form 2210 regular-method penalty and report it on Form 1040 line 38 (or attach Form 2210 when a Part II box applies). */
  computeForm2210?: boolean;
  /** Optional Form 2210 Part II boxes (`A` = full waiver, `B` = partial waiver, `D` = actual withholding dates, `E` = joint/separate filing change). */
  form2210Boxes?: ('A' | 'B' | 'C' | 'D' | 'E')[];
  /** Form 1040 line 36: overpayment to apply to next year's estimated tax ('all', or an amount; unset = refund it all). */
  applyToNextYear?: 'all' | Cents;
}

/** Inputs that only the state return needs. */
export interface StateReturnFacts {
  /** Part of tax-exempt interest (1099-INT box 8 + 1099-DIV box 12) from bonds of YOUR state. null = not answered yet. */
  homeStateMuniInterest: Cents | null;
  /** 2025 estimated payments to Maryland, including the one paid in January 2026. */
  estimatedPayments: Cents[];
  /** The same payments by the installment they count toward (Form 502UP); late ones are left out. */
  estimatedByQuarter?: [Cents, Cents, Cents, Cents];
  /** Overpayment from your 2024 state return applied to 2025. */
  priorYearApplied: Cents;
  /** Paid with a Maryland extension request (Form 502E). */
  extensionPayment: Cents;
  /** Prior-year (2024) Maryland total tax (2024 Form 502 line 34) for Form 502UP line 9a 110% safe harbor. */
  priorYearMdTax?: Cents | null;
  /** True to compute and attach Maryland Form 502UP (Underpayment of Estimated Income Tax by Individuals -> Form 502 line 51). */
  computeForm502UP?: boolean;
  /** Form 502 line 49: overpayment to apply to next year's estimated tax ('all', or an amount; unset = refund it all). */
  applyToNextYear?: 'all' | Cents;
}

export interface TaxFacts {
  taxYear: 2025 | 2026;
  /** The user's yes to claiming 1099 foreign tax as a credit without Form 1116 (Schedule 3 line 1). */
  claimForeignTaxCredit?: boolean;
  /** Schedule 1-A Parts II–IV, from answers: the household's qualified tips (W-2 box 7) and overtime premium, and
   *  up to two new-vehicle loans. */
  newDeductions?: { tips: Cents; overtime: Cents; carLoans: { vin: string; interest: Cents }[] };
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
  f1099G?: Form1099G[];
  /** A 2024 state or local income tax refund received (or applied to estimates) in 2025, with what the refund
   *  worksheet needs from the 2024 return. `priorYear` is null when there's no 2024 return. */
  stateRefund?: {
    refund: Cents;
    priorYear: {
      filingStatus: FilingStatus;
      /** 2024 Schedule A; null when the 2024 return took the standard deduction, undefined when Tidy didn't read it. */
      itemized: { salesTaxElected: boolean; line5d: Cents; line5e: Cents; line17: Cents } | null | undefined;
      ageOrBlindBoxes: number;
    } | null;
  };
  ssa1099?: Ssa1099[];
  scheduleC?: ScheduleCBusiness[];
  rentals?: RentalProperty[];
  k1s?: ScheduleK1[];
  mdDecoupling?: MdDecouplingFacts | null;
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
