import { usd } from '../../src/engine/money';
import type { Form1099Div, Form1099Int, Form1099R, Ssa1099, TaxFacts, W2 } from '../../src/shared/facts';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function w2(p: Partial<W2> & { box1Wages: number }): W2 {
  return {
    id: nextId('w2'),
    owner: 'taxpayer',
    employerName: 'Acme Corp',
    employerEin: null,
    employerAddress: null,
    retirementPlan: false,
    box14: [],
    box2FedWithheld: 0,
    box3SsWages: 0,
    box4SsWithheld: 0,
    box5MedicareWages: p.box1Wages,
    box6MedicareWithheld: 0,
    box12: [],
    stateLines: [],
    localLines: [],
    evidence: {},
    ...p,
  };
}

export function int1099(p: Partial<Form1099Int>): Form1099Int {
  return {
    id: nextId('int'),
    owner: 'taxpayer',
    payerName: 'First Bank',
    box1Interest: 0,
    box3UsTreasuryInterest: 0,
    box4FedWithheld: 0,
    box6ForeignTaxPaid: 0,
    box8TaxExemptInterest: 0,
    box9PrivateActivityBondInterest: 0,
    evidence: {},
    ...p,
  };
}

export function div1099(p: Partial<Form1099Div>): Form1099Div {
  return {
    id: nextId('div'),
    owner: 'taxpayer',
    payerName: 'Big Brokerage',
    box1aOrdinaryDividends: 0,
    box1bQualifiedDividends: 0,
    box2aCapitalGainDistributions: 0,
    box2bUnrecaptured1250Gain: 0,
    box2d28RateGain: 0,
    box4FedWithheld: 0,
    box5Section199aDividends: 0,
    box7ForeignTaxPaid: 0,
    box12ExemptInterestDividends: 0,
    box13PrivateActivityBondDividends: 0,
    evidence: {},
    ...p,
  };
}

export function r1099(p: Partial<Form1099R>): Form1099R {
  return {
    id: nextId('r'),
    owner: 'taxpayer',
    payerName: 'State Retirement System',
    payerEin: null,
    box1GrossDistribution: 0,
    box2aTaxableAmount: 0,
    box2bTaxableNotDetermined: false,
    box2bTotalDistribution: false,
    box4FedWithheld: 0,
    box5EmployeeContributions: 0,
    box7Codes: '7',
    iraSepSimple: false,
    stateLines: [],
    evidence: {},
    ...p,
  };
}

export function ssa1099(p: Partial<Ssa1099>): Ssa1099 {
  const paid = p.box3BenefitsPaid ?? p.box5NetBenefits ?? 0;
  const repaid = p.box4BenefitsRepaid ?? 0;
  return {
    id: nextId('ssa'),
    owner: 'taxpayer',
    box3BenefitsPaid: paid,
    box4BenefitsRepaid: repaid,
    box5NetBenefits: p.box5NetBenefits ?? paid - repaid,
    box6FedWithheld: 0,
    evidence: {},
    ...p,
  };
}

export function facts(p: Partial<TaxFacts> = {}): TaxFacts {
  return {
    taxYear: 2025,
    filingStatus: 'single',
    taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1980-01-01' },
    spouse: null,
    address: { street: '1 Main St', apt: null, city: 'Rockville', state: 'MD', zip: '20850' },
    residency: {
      state: 'MD',
      fullYear: true,
      mdCounty: 'Montgomery',
      mdSubdivision: { code: '1609', name: 'City of Rockville' },
    },
    digitalAssets: false,
    w2s: [],
    f1099Int: [],
    f1099Div: [],
    f1099R: [],
    ssa1099: [],
    hasNondeductibleIraBasis: false,
    itemized: {
      medicalExpenses: 0,
      stateIncomeTaxPayments: [],
      realEstateTax: 0,
      personalPropertyTax: 0,
      mortgageInterest1098: 0,
      investmentInterest: 0,
      charityCash: 0,
      charityNonCash: 0,
      charityCarryover: 0,
    },
    forceItemize: false,
    payments: { federalEstimated: [], federalPriorYearApplied: 0, federalExtensionPayment: 0 },
    foreignAccounts: { hasForeignAccount: false, fbarRequired: null, countries: [], foreignTrust: false },
    stateReturn: { homeStateMuniInterest: 0, estimatedPayments: [], priorYearApplied: 0, extensionPayment: 0 },
    ...p,
  };
}

/** S1 — single, one W-2, standard deduction, Tax Table path. */
export const S1 = facts({
  w2s: [
    w2({
      box1Wages: usd(85_000),
      box2FedWithheld: usd(11_000),
      box3SsWages: usd(85_000),
      box4SsWithheld: usd(5_270),
      box6MedicareWithheld: usd(1_232.5),
      stateLines: [{ state: 'MD', stateWages: usd(85_000), stateTax: usd(4_100) }],
    }),
  ],
});

/** S2 — married filing jointly, two W-2s, interest, dividends, itemized under the $40,000 SALT cap. */
export const S2 = facts({
  filingStatus: 'mfj',
  spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-02-02' },
  w2s: [
    w2({
      owner: 'taxpayer',
      box1Wages: usd(310_000),
      box2FedWithheld: usd(70_000),
      box3SsWages: usd(176_100),
      box4SsWithheld: usd(10_918.2),
      box5MedicareWages: usd(330_000),
      box6MedicareWithheld: usd(5_955),
      stateLines: [{ state: 'MD', stateWages: usd(310_000), stateTax: usd(20_000) }],
    }),
    w2({
      owner: 'spouse',
      employerName: 'Beta LLC',
      box1Wages: usd(90_000),
      box2FedWithheld: usd(15_000),
      box3SsWages: usd(93_500),
      box4SsWithheld: usd(5_797),
      box5MedicareWages: usd(93_500),
      box6MedicareWithheld: usd(1_355.75),
      stateLines: [{ state: 'MD', stateWages: usd(90_000), stateTax: usd(6_000) }],
    }),
  ],
  f1099Int: [int1099({ box1Interest: usd(12_000), box8TaxExemptInterest: usd(3_000) })],
  f1099Div: [
    div1099({ box1aOrdinaryDividends: usd(30_000), box1bQualifiedDividends: usd(24_000), box2aCapitalGainDistributions: usd(5_000) }),
  ],
  itemized: {
    ...facts().itemized,
    realEstateTax: usd(18_000),
    mortgageInterest1098: usd(22_000),
    charityCash: usd(15_000),
  },
  payments: { federalEstimated: [usd(2_500), usd(2_500), usd(2_500), usd(2_500)], federalPriorYearApplied: 0, federalExtensionPayment: 0 },
});

/** S3 — single, $1.25M AGI, two employers (excess SS), SALT floor, 37% bracket, 20% rate, NIIT. */
export const S3 = facts({
  w2s: [
    w2({
      box1Wages: usd(700_000),
      box2FedWithheld: usd(200_000),
      box3SsWages: usd(176_100),
      box4SsWithheld: usd(10_918.2),
      box5MedicareWages: usd(720_000),
      box6MedicareWithheld: usd(15_120),
      stateLines: [{ state: 'MD', stateWages: usd(700_000), stateTax: usd(70_000) }],
      localLines: [],
    }),
    w2({
      employerName: 'Gamma Inc',
      box1Wages: usd(300_000),
      box2FedWithheld: usd(80_000),
      box3SsWages: usd(176_100),
      box4SsWithheld: usd(10_918.2),
      box5MedicareWages: usd(300_000),
      box6MedicareWithheld: usd(5_250),
      stateLines: [{ state: 'MD', stateWages: usd(300_000), stateTax: usd(28_000) }],
      localLines: [],
    }),
  ],
  f1099Int: [int1099({ box1Interest: usd(40_000) })],
  f1099Div: [
    div1099({ box1aOrdinaryDividends: usd(150_000), box1bQualifiedDividends: usd(140_000), box2aCapitalGainDistributions: usd(60_000) }),
  ],
  itemized: {
    ...facts().itemized,
    realEstateTax: usd(30_000),
    mortgageInterest1098: usd(30_000),
    charityCash: usd(100_000),
  },
  payments: {
    federalEstimated: [usd(10_000), usd(10_000), usd(10_000), usd(10_000)],
    federalPriorYearApplied: 0,
    federalExtensionPayment: 0,
  },
});
