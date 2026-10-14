import type {
  AmountT,
  F1099BExtractionT,
  F1099RExtractionT,
  PriorYearExtractionT,
  Ssa1099ExtractionT,
  W2ExtractionT,
} from '../../src/shared/schemas/extraction';
import { reconcileQuestions } from '../../src/core/reconcile';
import { emptyState, type AppState, type DocumentRecord, type Extraction, type FieldCheck } from '../../src/shared/state';

export const NOW = '2026-10-13T12:00:00.000Z';

/** Answer questions one at a time, re-running reconcile like the app does. */
export function answered(s: AppState, answers: Record<string, string>): AppState {
  let state = { ...s, questions: reconcileQuestions(s) };
  for (const [id, value] of Object.entries(answers)) {
    state = { ...state, questions: state.questions.map((q) => (q.id === id ? { ...q, answer: value, answeredAt: 'now' } : q)) };
    state = { ...state, questions: reconcileQuestions(state) };
  }
  return state;
}

export const amt = (amount: string | null, page = 1): AmountT => ({ amount, page, quote: amount ? `Wages ${amount}` : null });

export function doc(id: string, extractions: Extraction[], p: Partial<DocumentRecord> = {}): DocumentRecord {
  const fieldChecks: Record<string, FieldCheck> = {};
  return {
    id,
    fileName: `${id}.pdf`,
    sha256: `sha-${id}`,
    mimeType: 'application/pdf',
    pageCount: 2,
    hasTextLayer: true,
    addedAt: NOW,
    status: 'done',
    classification: null,
    docType: null,
    extractions,
    fieldChecks,
    supersededBy: null,
    error: null,
    ...p,
  };
}

export function w2Extraction(p: Partial<W2ExtractionT> = {}): Extraction {
  return {
    form: 'w2',
    firstPage: 1,
    data: {
      employerName: 'Acme Corp',
      employerEin: '12-3456789',
      employeeName: 'Alex Rivera',
      employeeSsnLast4: '0001',
      employerAddress: { street: '1 Acme Way', city: 'Bethesda', state: 'MD', zip: '20814' },
      box13RetirementPlan: true,
      box14: [],
      box1Wages: amt('85,000.00'),
      box2FedWithheld: amt('11,000.00'),
      box3SsWages: amt('85,000.00'),
      box4SsWithheld: amt('5,270.00'),
      box5MedicareWages: amt('85,000.00'),
      box6MedicareWithheld: amt('1,232.50'),
      box12: [],
      stateLines: [{ state: 'MD', stateWages: amt('85,000.00'), stateTax: amt('4,100.00') }],
      localLines: [],
      ...p,
    },
  };
}

export function r1099Extraction(p: Partial<F1099RExtractionT> = {}): Extraction {
  return {
    form: 'f1099_r',
    firstPage: 1,
    data: {
      payerName: 'State Retirement System',
      payerEin: '52-1234567',
      recipientName: 'Alex Rivera',
      recipientSsnLast4: '0001',
      box1GrossDistribution: amt('35,000.00'),
      box2aTaxableAmount: amt('35,000.00'),
      box2bTaxableNotDetermined: false,
      box2bTotalDistribution: false,
      box4FedWithheld: amt('3,500.00'),
      box5EmployeeContributions: amt(null),
      box7Codes: '7',
      box7IraSepSimple: false,
      stateLines: [{ state: 'MD', stateTax: amt('1,500.00'), stateDistribution: amt('35,000.00') }],
      ...p,
    },
  };
}

export function ssa1099Extraction(p: Partial<Ssa1099ExtractionT> = {}): Extraction {
  return {
    form: 'ssa_1099',
    firstPage: 1,
    data: {
      recipientName: 'Alex Rivera',
      recipientSsnLast4: '0001',
      box3BenefitsPaid: amt('20,000.00'),
      box4BenefitsRepaid: amt(null),
      box5NetBenefits: amt('20,000.00'),
      box6FedWithheld: amt('2,000.00'),
      ...p,
    },
  };
}

export function b1099Extraction(p: Partial<F1099BExtractionT> = {}): Extraction {
  return {
    form: 'f1099_b',
    firstPage: 1,
    data: {
      payerName: 'Charles Schwab & Co., Inc.',
      recipientName: 'Alex Rivera',
      box4FedWithheld: amt(null),
      lots: [
        {
          description: '100 sh. AAPL',
          dateAcquired: '01/15/2023',
          dateSold: '08/20/2025',
          proceeds: amt('25,000.00'),
          costBasis: amt('15,000.00'),
          marketDiscount: amt(null),
          washSaleDisallowed: amt(null),
          box: 'D',
          collectibles: false,
        },
      ],
      ...p,
    },
  };
}

export function priorYear(p: Partial<PriorYearExtractionT> = {}): Extraction {
  const none = amt(null);
  return {
    form: 'prior_year',
    firstPage: 1,
    data: {
      taxYear: 2024,
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001' },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002' },
      address: { street: '1 Main St', apt: null, city: 'Rockville', state: 'MD', zip: '20850' },
      dependents: [],
      residentState: 'MD',
      mdCounty: 'Montgomery',
      mdSubdivisionCode: null,
      agi: amt('430,000'),
      totalTax: amt('90,000'),
      appliedToNextYear: amt('5,000'),
      stateBalanceDue: amt('3,200'),
      stateAppliedToNextYear: amt(null),
      payers: [
        { name: 'Acme Corp', form: 'w2' },
        { name: 'Charles Schwab & Co., Inc.', form: 'f1099_div' },
      ],
      carryovers: {
        capitalLossShortTerm: none,
        capitalLossLongTerm: none,
        charitable: none,
        passiveLoss: none,
        amtCredit: none,
        foreignTaxCredit: none,
        investmentInterest: none,
      },
      ...p,
    },
  };
}

export function stateWith(p: Partial<AppState> = {}): AppState {
  return { ...emptyState(NOW), onboarding: { welcomed: true, priorYearSkipped: false }, ...p };
}
