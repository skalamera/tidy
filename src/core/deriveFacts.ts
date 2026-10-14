import type { AmountT, PriorYearExtractionT } from '../shared/schemas/extraction';
import type { DocumentRecord, AppState } from '../shared/state';
import type { Evidence, Owner, StateCode, TaxFacts } from '../shared/facts';
import { MD_LOCAL_2025, type MdCounty } from '../engine/params/md2025';
import { amountCents } from './amount';
import { ssnDigits } from '../shared/answers';
import { applyOverrides } from './overrides';
import { RULES } from './questionRules';

export function emptyFacts(): TaxFacts {
  return {
    taxYear: 2025,
    filingStatus: 'single',
    taxpayer: { firstName: '', lastName: '', ssn: '', dateOfBirth: null },
    spouse: null,
    address: { street: '', apt: null, city: '', state: '', zip: '' },
    residency: { state: null, fullYear: null, mdCounty: null, mdSubdivision: null },
    digitalAssets: null,
    w2s: [],
    f1099Int: [],
    f1099Div: [],
    f1099B: [],
    f1099R: [],
    ssa1099: [],
    carryovers: {
      capitalLossShortTerm: 0,
      capitalLossLongTerm: 0,
      qbiLoss: 0,
      reitPtpLoss: 0,
    },
    hasNondeductibleIraBasis: null,
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
    foreignAccounts: { hasForeignAccount: null, fbarRequired: null, countries: [], foreignTrust: null },
    stateReturn: { homeStateMuniInterest: null, estimatedPayments: [], priorYearApplied: 0, extensionPayment: 0 },
  };
}

const asState = (s: string | null): StateCode | null => (s === 'MD' ? s : null);

const MD_COUNTIES = Object.keys(MD_LOCAL_2025) as MdCounty[];
/** Lowercase, no apostrophes or periods, "Saint" as "st", single spaces. */
const countyKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’'.]/g, '')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim();

/** A county as last year's return printed it ("MONTGOMERY", "Prince George’s County"), or null when it isn't one of
 *  Maryland's. A bare "Baltimore" is null too, because it could be the city or the county. */
const asMdCounty = (raw: string | null): MdCounty | null => {
  if (raw === null) return null;
  const k = countyKey(raw).replace(/ co$/, ' county');
  return MD_COUNTIES.find((c) => [k, k.replace(/ county$/, '')].includes(countyKey(c))) ?? null;
};

/** Tidy prepares 2025, so last year's return is the 2024 one. A return for another year is set aside (see flags). */
export const PRIOR_TAX_YEAR = 2024;

export function latestPriorYear(state: AppState): PriorYearExtractionT | null {
  for (const d of [...state.documents].reverse()) {
    if (d.status !== 'done' || d.supersededBy) continue;
    const x = d.extractions.find((e) => e.form === 'prior_year');
    if (x && x.form === 'prior_year' && x.data.taxYear === PRIOR_TAX_YEAR) return x.data;
  }
  return null;
}

function evidence(doc: DocumentRecord, idx: number, path: string, a: AmountT): Evidence {
  const firstPage = doc.extractions[idx]?.firstPage ?? 1;
  const page = a.page === null ? null : firstPage + a.page - 1;
  return { docId: doc.id, page, quote: a.quote, verified: doc.fieldChecks[`${idx}:${path}`] === 'verified' };
}

/** Taxpayer unless the name/SSN on the form clearly matches the spouse. */
export function guessOwner(f: TaxFacts, name: string, ssnLast4: string | null): Owner {
  if (!f.spouse) return 'taxpayer';
  if (ssnLast4 && f.spouse.ssn.endsWith(ssnLast4)) return 'spouse';
  if (ssnLast4 && f.taxpayer.ssn.endsWith(ssnLast4)) return 'taxpayer';
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return first !== '' && first === f.spouse.firstName.toLowerCase() ? 'spouse' : 'taxpayer';
}

/** Facts are DERIVED, never edited in place: documents → answers → overrides. Pure and idempotent. */
export function deriveFacts(state: AppState): TaxFacts {
  const f = emptyFacts();
  const prior = latestPriorYear(state);
  if (prior) {
    f.filingStatus = prior.filingStatus;
    // Returns print SSNs as 123-45-6789; the forms' SSN boxes take the 9 digits. A masked or partial SSN becomes ''
    // here, and the identity question rules (same ssnDigits test) ask for it instead.
    f.taxpayer = {
      firstName: prior.taxpayer.firstName,
      lastName: prior.taxpayer.lastName,
      ssn: ssnDigits(prior.taxpayer.ssn ?? '') ?? '',
      dateOfBirth: null,
    };
    f.spouse = prior.spouse
      ? {
          firstName: prior.spouse.firstName,
          lastName: prior.spouse.lastName,
          ssn: ssnDigits(prior.spouse.ssn ?? '') ?? '',
          dateOfBirth: null,
        }
      : null;
    f.address = { ...prior.address };
    f.residency = { ...f.residency, state: asState(prior.residentState), mdCounty: asMdCounty(prior.mdCounty) };
    f.payments.federalPriorYearApplied = amountCents(prior.appliedToNextYear);
    f.stateReturn.priorYearApplied = amountCents(prior.stateAppliedToNextYear);
    if (f.stateReturn.priorYearApplied > 0) {
      f.itemized.stateIncomeTaxPayments.push({ label: '2024 state refund applied to 2025', amount: f.stateReturn.priorYearApplied });
    }
    f.carryovers = {
      capitalLossShortTerm: Math.abs(amountCents(prior.carryovers.capitalLossShortTerm)),
      capitalLossLongTerm: Math.abs(amountCents(prior.carryovers.capitalLossLongTerm)),
      qbiLoss: prior.carryovers.qbiLoss ? Math.abs(amountCents(prior.carryovers.qbiLoss)) : 0,
      reitPtpLoss: prior.carryovers.reitPtpLoss ? Math.abs(amountCents(prior.carryovers.reitPtpLoss)) : 0,
    };
  }

  for (const doc of state.documents) {
    if (doc.status !== 'done' || doc.supersededBy) continue;
    doc.extractions.forEach((x, i) => {
      const id = `${x.form}-${doc.id}-${i}`;
      const ev = (path: string, a: AmountT) => evidence(doc, i, path, a);
      switch (x.form) {
        case 'w2': {
          const d = x.data;
          f.w2s.push({
            id,
            owner: guessOwner(f, d.employeeName, d.employeeSsnLast4),
            employerName: d.employerName,
            employerEin: d.employerEin,
            employerAddress: d.employerAddress,
            retirementPlan: d.box13RetirementPlan,
            box14: d.box14.map((b) => ({ description: b.description, amount: amountCents(b.amount) })),
            box1Wages: amountCents(d.box1Wages),
            box2FedWithheld: amountCents(d.box2FedWithheld),
            box3SsWages: amountCents(d.box3SsWages),
            box4SsWithheld: amountCents(d.box4SsWithheld),
            box5MedicareWages: amountCents(d.box5MedicareWages),
            box6MedicareWithheld: amountCents(d.box6MedicareWithheld),
            box12: d.box12.map((b) => ({ code: b.code, amount: amountCents(b.amount) })),
            stateLines: d.stateLines.map((s) => ({
              state: s.state ?? '',
              stateWages: amountCents(s.stateWages),
              stateTax: amountCents(s.stateTax),
            })),
            localLines: d.localLines.map((s) => ({
              locality: s.locality ?? '',
              localWages: amountCents(s.localWages),
              localTax: amountCents(s.localTax),
            })),
            evidence: { box1Wages: ev('box1Wages', d.box1Wages), box2FedWithheld: ev('box2FedWithheld', d.box2FedWithheld) },
          });
          break;
        }
        case 'f1099_int': {
          const d = x.data;
          f.f1099Int.push({
            id,
            owner: guessOwner(f, d.recipientName, null),
            payerName: d.payerName,
            box1Interest: amountCents(d.box1Interest),
            box3UsTreasuryInterest: amountCents(d.box3UsTreasuryInterest),
            box4FedWithheld: amountCents(d.box4FedWithheld),
            box6ForeignTaxPaid: amountCents(d.box6ForeignTaxPaid),
            box8TaxExemptInterest: amountCents(d.box8TaxExemptInterest),
            box9PrivateActivityBondInterest: amountCents(d.box9PrivateActivityBondInterest),
            evidence: { box1Interest: ev('box1Interest', d.box1Interest) },
          });
          break;
        }
        case 'f1099_div': {
          const d = x.data;
          f.f1099Div.push({
            id,
            owner: guessOwner(f, d.recipientName, null),
            payerName: d.payerName,
            box1aOrdinaryDividends: amountCents(d.box1aOrdinaryDividends),
            box1bQualifiedDividends: amountCents(d.box1bQualifiedDividends),
            box2aCapitalGainDistributions: amountCents(d.box2aCapitalGainDistributions),
            box2bUnrecaptured1250Gain: amountCents(d.box2bUnrecaptured1250Gain),
            box2d28RateGain: amountCents(d.box2d28RateGain),
            box4FedWithheld: amountCents(d.box4FedWithheld),
            box5Section199aDividends: amountCents(d.box5Section199aDividends),
            box7ForeignTaxPaid: amountCents(d.box7ForeignTaxPaid),
            box12ExemptInterestDividends: amountCents(d.box12ExemptInterestDividends),
            box13PrivateActivityBondDividends: amountCents(d.box13PrivateActivityBondDividends),
            evidence: { box1aOrdinaryDividends: ev('box1aOrdinaryDividends', d.box1aOrdinaryDividends) },
          });
          break;
        }
        case 'f1099_b': {
          const d = x.data;
          f.f1099B!.push({
            id,
            owner: guessOwner(f, d.recipientName, null),
            payerName: d.payerName,
            box4FedWithheld: amountCents(d.box4FedWithheld),
            lots: d.lots.map((l) => ({
              description: l.description,
              dateAcquired: l.dateAcquired,
              dateSold: l.dateSold,
              proceeds: amountCents(l.proceeds),
              costBasis: amountCents(l.costBasis),
              marketDiscount: amountCents(l.marketDiscount),
              washSaleDisallowed: amountCents(l.washSaleDisallowed),
              box: l.box,
              collectibles: l.collectibles,
            })),
            evidence: { box4FedWithheld: ev('box4FedWithheld', d.box4FedWithheld) },
          });
          break;
        }
        case 'f1099_r': {
          const d = x.data;
          f.f1099R!.push({
            id,
            owner: guessOwner(f, d.recipientName, d.recipientSsnLast4),
            payerName: d.payerName,
            payerEin: d.payerEin,
            box1GrossDistribution: amountCents(d.box1GrossDistribution),
            box2aTaxableAmount: amountCents(d.box2aTaxableAmount),
            box2bTaxableNotDetermined: d.box2bTaxableNotDetermined,
            box2bTotalDistribution: d.box2bTotalDistribution,
            box4FedWithheld: amountCents(d.box4FedWithheld),
            box5EmployeeContributions: amountCents(d.box5EmployeeContributions),
            box7Codes: d.box7Codes.trim().toUpperCase(),
            iraSepSimple: d.box7IraSepSimple,
            stateLines: d.stateLines.map((s) => ({
              state: s.state ?? '',
              stateTax: amountCents(s.stateTax),
              stateDistribution: amountCents(s.stateDistribution),
            })),
            evidence: {
              box1GrossDistribution: ev('box1GrossDistribution', d.box1GrossDistribution),
              box2aTaxableAmount: ev('box2aTaxableAmount', d.box2aTaxableAmount),
              box4FedWithheld: ev('box4FedWithheld', d.box4FedWithheld),
            },
          });
          break;
        }
        case 'ssa_1099': {
          const d = x.data;
          const paid = amountCents(d.box3BenefitsPaid);
          const repaid = amountCents(d.box4BenefitsRepaid);
          const net = d.box5NetBenefits.amount !== null ? amountCents(d.box5NetBenefits) : paid - repaid;
          f.ssa1099!.push({
            id,
            owner: guessOwner(f, d.recipientName, d.recipientSsnLast4),
            box3BenefitsPaid: paid || Math.max(0, net),
            box4BenefitsRepaid: repaid,
            box5NetBenefits: net,
            box6FedWithheld: amountCents(d.box6FedWithheld),
            evidence: {
              box5NetBenefits: ev('box5NetBenefits', d.box5NetBenefits),
              box6FedWithheld: ev('box6FedWithheld', d.box6FedWithheld),
            },
          });
          break;
        }
        case 'f1098':
          f.itemized.mortgageInterest1098 += amountCents(x.data.box1MortgageInterest);
          f.itemized.realEstateTax += amountCents(x.data.realEstateTaxPaid);
          break;
        case 'payment': {
          const d = x.data;
          const amt = amountCents(d.amount);
          const inYear = d.datePaid === null || d.datePaid.startsWith('2025');
          if (d.kind === 'property_tax' && inYear) f.itemized.realEstateTax += amt;
          if (d.kind === 'charity_cash' && inYear) f.itemized.charityCash += amt;
          if (d.kind === 'charity_noncash' && inYear) f.itemized.charityNonCash += amt;
          const forThisYear = d.forTaxYear === null ? true : d.forTaxYear === 2025;
          if (d.kind === 'federal_estimate' && forThisYear) f.payments.federalEstimated.push(amt);
          if (d.kind === 'state_estimate') {
            // Federal SALT counts what you PAID in calendar 2025; the state return counts what was paid FOR 2025.
            if (inYear)
              f.itemized.stateIncomeTaxPayments.push({
                label: `${d.state ?? 'State'} estimated payment ${d.datePaid ?? ''}`.trim(),
                amount: amt,
              });
            if (forThisYear && (d.state === null || d.state === f.residency.state)) f.stateReturn.estimatedPayments.push(amt);
          }
          break;
        }
        case 'prior_year':
          break;
      }
    });
  }

  for (const q of state.questions) {
    if (q.origin !== 'rule' || q.answer === null) continue;
    RULES.find((r) => r.id === q.id)?.apply(q.answer, f, prior);
  }

  return applyOverrides(f, state.overrides);
}
