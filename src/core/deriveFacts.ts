import type { AmountT, PriorYearExtractionT } from '../shared/schemas/extraction';
import type { DocumentRecord, AppState } from '../shared/state';
import type { Evidence, Owner, StateCode, TaxFacts } from '../shared/facts';
import { amountCents } from './amount';
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

export function latestPriorYear(state: AppState): PriorYearExtractionT | null {
  for (const d of [...state.documents].reverse()) {
    if (d.status !== 'done' || d.supersededBy) continue;
    const x = d.extractions.find((e) => e.form === 'prior_year');
    if (x && x.form === 'prior_year') return x.data;
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
    f.taxpayer = {
      firstName: prior.taxpayer.firstName,
      lastName: prior.taxpayer.lastName,
      ssn: prior.taxpayer.ssn ?? '',
      dateOfBirth: null,
    };
    f.spouse = prior.spouse
      ? { firstName: prior.spouse.firstName, lastName: prior.spouse.lastName, ssn: prior.spouse.ssn ?? '', dateOfBirth: null }
      : null;
    f.address = { ...prior.address };
    f.residency = { ...f.residency, state: asState(prior.residentState), mdCounty: prior.mdCounty };
    f.payments.federalPriorYearApplied = amountCents(prior.appliedToNextYear);
    f.stateReturn.priorYearApplied = amountCents(prior.stateAppliedToNextYear);
    if (f.stateReturn.priorYearApplied > 0) {
      f.itemized.stateIncomeTaxPayments.push({ label: '2024 state refund applied to 2025', amount: f.stateReturn.priorYearApplied });
    }
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
