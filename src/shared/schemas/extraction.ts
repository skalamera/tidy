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

export const F1098Extraction = z.object({
  lenderName: z.string(),
  box1MortgageInterest: Amount,
  box2OutstandingPrincipal: Amount,
  realEstateTaxPaid: Amount.describe('Property tax paid from escrow, if shown (often box 10).'),
  propertyAddress: z.string().nullable(),
});
export type F1098ExtractionT = z.infer<typeof F1098Extraction>;

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
  stateBalanceDue: Amount.describe('Amount owed on the state return (paid in the following year).'),
  stateAppliedToNextYear: Amount.describe('Maryland overpayment applied to next year’s estimated tax (Form 502 line 49).'),
  payers: z.array(z.object({ name: z.string(), form: z.enum(['w2', 'f1099_int', 'f1099_div', 'f1099_b', 'k1', 'f1098', 'other']) })),
  carryovers: z.object({
    capitalLossShortTerm: Amount,
    capitalLossLongTerm: Amount,
    charitable: Amount,
    passiveLoss: Amount,
    amtCredit: Amount,
    foreignTaxCredit: Amount,
    investmentInterest: Amount,
  }),
});
export type PriorYearExtractionT = z.infer<typeof PriorYearExtraction>;
