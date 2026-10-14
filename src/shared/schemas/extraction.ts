import { z } from 'zod';

/** Every amount the model reads comes with WHERE it read it, so we can verify it and show the source. */
export const Amount = z.object({
  amount: z.string().nullable().describe('The amount exactly as printed, e.g. "12,345.67". null if the box is blank.'),
  page: z.number().int().nullable().describe('1-based page number within the pages you were given.'),
  quote: z.string().nullable().describe('Up to 120 characters copied verbatim from that page that include the amount.'),
});
export type AmountT = z.infer<typeof Amount>;

export const DOC_TYPES = [
  'prior_year_federal_return',
  'prior_year_state_return',
  'w2',
  'f1099_int',
  'f1099_div',
  'f1099_composite',
  'f1099_b',
  'f1099_r',
  'f1099_misc',
  'f1099_nec',
  'ssa_1099',
  'k1_1065',
  'k1_1120s',
  'k1_1041',
  'f1098',
  'property_tax_bill',
  'charity_receipt',
  'estimated_payment_record',
  'brokerage_statement',
  'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Sub-forms inside one PDF (a brokerage "composite 1099" has several). */
export const PART_FORMS = [
  'f1040_return',
  'state_return',
  'w2',
  'f1099_int',
  'f1099_div',
  'f1099_b',
  'f1099_r',
  'f1099_nec',
  'ssa_1099',
  'f1099_misc',
  'f1099_oid',
  'f1098',
  'k1',
  'other',
] as const;
export type PartForm = (typeof PART_FORMS)[number];

export const Classification = z.object({
  docType: z.enum(DOC_TYPES),
  taxYear: z.number().int().nullable(),
  issuerName: z.string().nullable().describe('Employer, bank, brokerage or agency that issued the document.'),
  recipientName: z.string().nullable(),
  isCorrected: z.boolean().describe('true if marked CORRECTED or is a W-2c.'),
  confidence: z.enum(['high', 'medium', 'low']),
  parts: z.array(z.object({ form: z.enum(PART_FORMS), firstPage: z.number().int(), lastPage: z.number().int() })),
});
export type ClassificationT = z.infer<typeof Classification>;

export const W2Extraction = z.object({
  employerName: z.string(),
  employerEin: z.string().nullable(),
  employerAddress: z.object({ street: z.string(), city: z.string(), state: z.string(), zip: z.string() }).nullable(),
  box13RetirementPlan: z.boolean().describe('Box 13 "Retirement plan" is checked.'),
  box14: z.array(z.object({ description: z.string(), amount: Amount })),
  employeeName: z.string(),
  employeeSsnLast4: z.string().nullable(),
  box1Wages: Amount,
  box2FedWithheld: Amount,
  box3SsWages: Amount,
  box4SsWithheld: Amount,
  box5MedicareWages: Amount,
  box6MedicareWithheld: Amount,
  box12: z.array(z.object({ code: z.string(), amount: Amount })),
  stateLines: z.array(z.object({ state: z.string().nullable(), stateWages: Amount, stateTax: Amount })),
  localLines: z.array(z.object({ locality: z.string().nullable(), localWages: Amount, localTax: Amount })),
});
export type W2ExtractionT = z.infer<typeof W2Extraction>;

export const F1099IntExtraction = z.object({
  payerName: z.string(),
  recipientName: z.string(),
  box1Interest: Amount,
  box3UsTreasuryInterest: Amount,
  box4FedWithheld: Amount,
  box6ForeignTaxPaid: Amount,
  box8TaxExemptInterest: Amount,
  box9PrivateActivityBondInterest: Amount,
});
export type F1099IntExtractionT = z.infer<typeof F1099IntExtraction>;

export const F1099DivExtraction = z.object({
  payerName: z.string(),
  recipientName: z.string(),
  box1aOrdinaryDividends: Amount,
  box1bQualifiedDividends: Amount,
  box2aCapitalGainDistributions: Amount,
  box2bUnrecaptured1250Gain: Amount,
  box2d28RateGain: Amount,
  box4FedWithheld: Amount,
  box5Section199aDividends: Amount,
  box7ForeignTaxPaid: Amount,
  box12ExemptInterestDividends: Amount,
  box13PrivateActivityBondDividends: Amount.describe('Box 13: specified private activity bond interest dividends.'),
});
export type F1099DivExtractionT = z.infer<typeof F1099DivExtraction>;

export const F1099BLot = z.object({
  description: z.string().describe('Box 1a: Description of property (e.g. "100 sh. AAPL" or summary category description).'),
  dateAcquired: z.string().nullable().describe('Box 1b: Date acquired (MM/DD/YYYY or "VARIOUS").'),
  dateSold: z.string().nullable().describe('Box 1c: Date sold or disposed of (MM/DD/YYYY or "VARIOUS").'),
  proceeds: Amount.describe('Box 1d: Proceeds (sales price).'),
  costBasis: Amount.describe('Box 1e: Cost or other basis.'),
  marketDiscount: Amount.describe('Box 1f: Accrued market discount.'),
  washSaleDisallowed: Amount.describe('Box 1g: Wash sale loss disallowed.'),
  box: z
    .enum(['A', 'B', 'C', 'D', 'E', 'F'])
    .describe(
      'Form 8949 box: A=short-term basis reported to IRS, B=short-term basis not reported, D=long-term basis reported to IRS, E=long-term basis not reported.',
    ),
  collectibles: z.boolean().describe('True if Box 2 "Collectibles" is checked.'),
});

export const F1099BExtraction = z.object({
  payerName: z.string(),
  recipientName: z.string(),
  box4FedWithheld: Amount,
  lots: z.array(F1099BLot).describe('Every sale lot or category summary reported on Form 1099-B.'),
});
export type F1099BExtractionT = z.infer<typeof F1099BExtraction>;

export const F1098Extraction = z.object({
  lenderName: z.string(),
  box1MortgageInterest: Amount,
  box2OutstandingPrincipal: Amount,
  realEstateTaxPaid: Amount.describe('Property tax paid from escrow, if shown (often box 10).'),
  propertyAddress: z.string().nullable(),
});
export type F1098ExtractionT = z.infer<typeof F1098Extraction>;

export const F1099RExtraction = z.object({
  payerName: z.string(),
  payerEin: z.string().nullable(),
  recipientName: z.string(),
  recipientSsnLast4: z.string().nullable(),
  box1GrossDistribution: Amount,
  box2aTaxableAmount: Amount,
  box2bTaxableNotDetermined: z.boolean().describe('Box 2b "Taxable amount not determined" is checked.'),
  box2bTotalDistribution: z.boolean().describe('Box 2b "Total distribution" is checked.'),
  box4FedWithheld: Amount,
  box5EmployeeContributions: Amount.describe('Box 5: employee contributions / designated Roth contributions or insurance premiums.'),
  box7Codes: z.string().describe('Distribution code(s) printed in box 7, e.g. "7", "G", "7B", "1".'),
  box7IraSepSimple: z.boolean().describe('Box 7 "IRA/SEP/SIMPLE" checkbox is checked.'),
  stateLines: z.array(
    z.object({
      state: z.string().nullable(),
      stateTax: Amount.describe('Box 14: state tax withheld.'),
      stateDistribution: Amount.describe('Box 16: state distribution.'),
    }),
  ),
});
export type F1099RExtractionT = z.infer<typeof F1099RExtraction>;

export const Ssa1099Extraction = z.object({
  recipientName: z.string(),
  recipientSsnLast4: z.string().nullable(),
  box3BenefitsPaid: Amount.describe('Box 3: Benefits paid in 2025.'),
  box4BenefitsRepaid: Amount.describe('Box 4: Benefits repaid to SSA in 2025.'),
  box5NetBenefits: Amount.describe('Box 5: Net benefits for 2025 (box 3 minus box 4).'),
  box6FedWithheld: Amount.describe('Box 6: Voluntary federal income tax withheld.'),
});
export type Ssa1099ExtractionT = z.infer<typeof Ssa1099Extraction>;

export const F1099NecExtraction = z.object({
  payerName: z.string(),
  payerEin: z.string().nullable(),
  recipientName: z.string(),
  recipientSsnLast4: z.string().nullable(),
  box1NonemployeeCompensation: Amount.describe('Box 1: Nonemployee compensation.'),
  box4FedWithheld: Amount.describe('Box 4: Federal income tax withheld.'),
  stateLines: z.array(
    z.object({
      state: z.string().nullable(),
      stateTax: Amount.describe('Box 5: State tax withheld.'),
      stateIncome: Amount.describe('Box 7: State income.'),
    }),
  ),
});
export type F1099NecExtractionT = z.infer<typeof F1099NecExtraction>;

export const K1Extraction = z.object({
  entityType: z
    .enum(['1065', '1120S', '1041'])
    .describe('Schedule K-1 form type: 1065 (Partnership), 1120S (S Corporation), or 1041 (Estate/Trust).'),
  entityName: z.string().describe('Part I: Name of partnership, S corporation, estate, or trust.'),
  entityEin: z.string().nullable().describe('Part I: Employer identification number (EIN) of the entity.'),
  recipientName: z.string().describe('Part II: Partner, shareholder, or beneficiary name.'),
  recipientSsnLast4: z.string().nullable(),
  ordinaryBusinessIncome: Amount.describe(
    'Part III Box 1 (1065/1120-S) or Box 6 (1041): Ordinary business income (loss). Can be negative.',
  ),
  netRentalRealEstateIncome: Amount.describe(
    'Part III Box 2 (1065/1120-S) or Box 7 (1041): Net rental real estate income (loss). Can be negative.',
  ),
  otherNetRentalIncome: Amount.describe('Part III Box 3 (1065/1120-S) or Box 8 (1041): Other net rental income (loss). Can be negative.'),
  guaranteedPayments: Amount.describe('Form 1065 Box 4c: Total guaranteed payments (0 for 1120-S / 1041).'),
  interestIncome: Amount.describe('Box 5 (1065) / Box 4 (1120-S) / Box 1 (1041): Interest income.'),
  ordinaryDividends: Amount.describe('Box 6a (1065) / Box 5a (1120-S) / Box 2a (1041): Ordinary dividends.'),
  qualifiedDividends: Amount.describe('Box 6b (1065) / Box 5b (1120-S) / Box 2b (1041): Qualified dividends.'),
  royalties: Amount.describe('Box 7 (1065) / Box 6 (1120-S): Royalties.'),
  netShortTermCapitalGain: Amount.describe(
    'Box 8 (1065) / Box 7 (1120-S) / Box 3 (1041): Net short-term capital gain (loss). Can be negative.',
  ),
  netLongTermCapitalGain: Amount.describe(
    'Box 9a (1065) / Box 8a (1120-S) / Box 4a (1041): Net long-term capital gain (loss). Can be negative.',
  ),
  collectibles28Gain: Amount.describe('Box 9b (1065) / Box 8b (1120-S) / Box 4b (1041): Collectibles (28%) gain (loss).'),
  unrecaptured1250Gain: Amount.describe('Box 9c (1065) / Box 8c (1120-S) / Box 4c (1041): Unrecaptured section 1250 gain.'),
  netSection1231Gain: Amount.describe('Box 10 (1065) / Box 9 (1120-S): Net section 1231 gain (loss). Can be negative.'),
  section179Deduction: Amount.describe('Box 12 (1065) / Box 11 (1120-S): Section 179 deduction.'),
  selfEmploymentEarnings: Amount.describe('Form 1065 Box 14 code A: Net earnings (loss) from self-employment.'),
  distributions: Amount.describe('Form 1120-S Box 16 code D or Form 1065 Box 19 code A: Cash and marketable securities distributions.'),
  nondeductibleExpenses: Amount.describe('Form 1120-S Box 16 code C or Form 1065 Box 18 code C: Nondeductible expenses.'),
  qbiAmount: Amount.describe('Section 199A QBI (1065 Box 20 code Z / 1120-S Box 17 code V / 1041 Box 14 code I). Can be negative.'),
  qbiW2Wages: Amount.describe('Section 199A W-2 wages from the pass-through entity.'),
  qbiUbia: Amount.describe('Section 199A UBIA of qualified property from the pass-through entity.'),
});
export type K1ExtractionT = z.infer<typeof K1Extraction>;

export const PaymentExtraction = z.object({
  kind: z.enum(['property_tax', 'charity_cash', 'charity_noncash', 'federal_estimate', 'state_estimate', 'other']),
  payee: z.string(),
  datePaid: z.string().nullable().describe('YYYY-MM-DD'),
  forTaxYear: z
    .number()
    .int()
    .nullable()
    .describe('For estimated payments: the tax year the payment is for (a January 2026 payment is usually for 2025).'),
  amount: Amount,
  state: z.string().nullable().describe('Two-letter state for state estimates, e.g. "MD".'),
});
export type PaymentExtractionT = z.infer<typeof PaymentExtraction>;

const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh', 'qss'] as const;
export const PriorYearExtraction = z.object({
  taxYear: z.number().int(),
  filingStatus: z.enum(FILING_STATUSES),
  taxpayer: z.object({ firstName: z.string(), lastName: z.string(), ssn: z.string().nullable() }),
  spouse: z.object({ firstName: z.string(), lastName: z.string(), ssn: z.string().nullable() }).nullable(),
  address: z.object({ street: z.string(), apt: z.string().nullable(), city: z.string(), state: z.string(), zip: z.string() }),
  dependents: z.array(z.object({ firstName: z.string(), lastName: z.string(), relationship: z.string() })),
  residentState: z.string().nullable(),
  mdCounty: z.string().nullable(),
  mdSubdivisionCode: z.string().nullable().describe('Maryland Form 502 page 1: the 4-digit political subdivision code, e.g. "1609".'),
  agi: Amount,
  totalTax: Amount,
  appliedToNextYear: Amount.describe('Form 1040 line 36: overpayment applied to next year’s estimated tax.'),
  stateTotalTax: Amount.optional().describe('Maryland Form 502 line 34: total Maryland and local tax.'),
  stateBalanceDue: Amount.describe('Amount owed on the state return (paid in the following year).'),
  stateAppliedToNextYear: Amount.describe('Maryland overpayment applied to next year’s estimated tax (Form 502 line 49).'),
  payers: z.array(
    z.object({
      name: z.string(),
      form: z.enum(['w2', 'f1099_int', 'f1099_div', 'f1099_r', 'f1099_nec', 'ssa_1099', 'f1099_b', 'k1', 'f1098', 'other']),
    }),
  ),
  scheduleC: z
    .object({
      principalBusiness: z.string(),
      businessCode: z.string().nullable(),
      businessName: z.string().nullable(),
      ein: z.string().nullable(),
      homeOfficeTotalSqFt: z.number().int().nullable(),
      homeOfficeBusinessSqFt: z.number().int().nullable(),
    })
    .nullable()
    .optional(),
  rentals: z
    .array(
      z.object({
        address: z.string(),
        propertyType: z.number().int().min(1).max(8).optional(),
        fairRentalDays: z.number().int().optional(),
        personalUseDays: z.number().int().optional(),
        activeParticipation: z.boolean().optional(),
        priorUnallowedPassiveLoss: Amount.optional().describe(
          'Unallowed passive loss carried forward from this year’s Form 8582 worksheet to the next year for this rental property.',
        ),
        depreciableAssets: z
          .array(
            z.object({
              description: z.string(),
              placedInService: z.string().describe('MM/YYYY'),
              basis: Amount,
              recoveryPeriodYears: z.number().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  passiveActivityCarryovers: z
    .array(
      z.object({
        activityName: z.string(),
        unallowedLoss: Amount,
      }),
    )
    .optional()
    .describe('Per-activity unallowed passive losses carried forward to the next year on Form 8582 Worksheets 5, 6, and 7.'),
  mdDecoupling: z
    .object({
      federalDepreciation: Amount,
      mdDepreciationWithoutDecoupling: Amount,
      pteDecouplingModification: Amount.optional(),
    })
    .nullable()
    .optional()
    .describe('Maryland Form 500DM decoupling modifications on the prior-year return.'),
  carryovers: z.object({
    capitalLossShortTerm: Amount,
    capitalLossLongTerm: Amount,
    qbiLoss: Amount.optional(),
    reitPtpLoss: Amount.optional(),
    charitable: Amount,
    passiveLoss: Amount,
    amtCredit: Amount,
    foreignTaxCredit: Amount,
    investmentInterest: Amount,
  }),
});
export type PriorYearExtractionT = z.infer<typeof PriorYearExtraction>;
