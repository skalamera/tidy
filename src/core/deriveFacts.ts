import type { AmountT, PriorYearExtractionT } from '../shared/schemas/extraction';
import type { DocumentRecord, AppState, Extraction, Override } from '../shared/state';
import type { Evidence, Owner, Person, StateCode, TaxFacts } from '../shared/facts';
import { MD_LOCAL_2025, type MdCounty } from '../engine/params/md2025';
import { amountCents } from './amount';
import { sumCents } from '../engine/money';
import { ssnDigits } from '../shared/answers';
import { sameIssuer } from './expected';
import { applyOverrides } from './overrides';
import { itemRuleOf } from './itemRules';
import { stateCode } from './states';

export { stateCode };
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
    f1099Nec: [],
    f1099G: [],
    ssa1099: [],
    scheduleC: [],
    rentals: [],
    k1s: [],
    mdDecoupling: null,
    carryovers: {
      capitalLossShortTerm: 0,
      capitalLossLongTerm: 0,
      qbiLoss: 0,
      reitPtpLoss: 0,
      charitable: 0,
      passiveLoss: 0,
      amtCredit: 0,
      foreignTaxCredit: 0,
      investmentInterest: 0,
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
    if (x && x.form === 'prior_year' && x.data.taxYear === PRIOR_TAX_YEAR) return withPriorStateReturn(state, x.data);
  }
  return null;
}

/** A 2024 state return uploaded on its own fills in what the federal package didn't include. */
function withPriorStateReturn(state: AppState, fed: PriorYearExtractionT): PriorYearExtractionT {
  for (const d of [...state.documents].reverse()) {
    if (d.status !== 'done' || d.supersededBy) continue;
    const x = d.extractions.find((e) => e.form === 'prior_state');
    if (!x || x.form !== 'prior_state' || x.data.taxYear !== PRIOR_TAX_YEAR) continue;
    const st = x.data;
    const blank = (a: AmountT | undefined) => !a || a.amount === null;
    return {
      ...fed,
      residentState: fed.residentState ?? st.state,
      mdCounty: fed.mdCounty ?? st.mdCounty,
      mdSubdivisionCode: fed.mdSubdivisionCode ?? st.mdSubdivisionCode,
      stateTotalTax: blank(fed.stateTotalTax) ? st.stateTotalTax : fed.stateTotalTax,
      stateBalanceDue: blank(fed.stateBalanceDue) ? st.stateBalanceDue : fed.stateBalanceDue,
      stateAppliedToNextYear: blank(fed.stateAppliedToNextYear) ? st.stateAppliedToNextYear : fed.stateAppliedToNextYear,
    };
  }
  return fed;
}

/** Information returns report one calendar year; one for another year (last year's W-2) isn't used (see flags).
 *  K-1s can be for a fiscal year that began in 2024, and bills and receipts count by the date paid, so they're kept. */
const YEARLY_FORMS = new Set([
  'w2',
  'f1099_int',
  'f1099_div',
  'f1099_composite',
  'f1099_b',
  'f1099_r',
  'f1099_misc',
  'f1099_nec',
  'f1099_g',
  'ssa_1099',
  'f1098',
]);
export const wrongYear = (doc: DocumentRecord): number | null => {
  const y = doc.classification?.taxYear ?? null;
  return y !== null && y !== 2025 && YEARLY_FORMS.has(doc.docType ?? '') ? y : null;
};

/** What the State and Local Income Tax Refund Worksheet needs: the 2024 refund (from 1099-Gs, else the 2024 state
 *  return's refund plus the overpayment applied to 2025, else a question) and the 2024 return's Schedule A. */
export function priorStateRefund(f: TaxFacts, prior: PriorYearExtractionT | null): NonNullable<TaxFacts['stateRefund']> {
  const fromForms = (f.f1099G ?? []).filter((g) => g.box2StateRefund > 0 && (g.box3TaxYear === null || g.box3TaxYear === PRIOR_TAX_YEAR));
  const refund =
    fromForms.length > 0
      ? sumCents(fromForms.map((g) => g.box2StateRefund))
      : stateReturnRead(prior)
        ? amountCents(prior!.stateRefund ?? { amount: null, page: null, quote: null }) + amountCents(prior!.stateAppliedToNextYear)
        : 0;
  const it = prior?.itemized;
  return {
    refund,
    priorYear: prior
      ? {
          filingStatus: prior.filingStatus,
          itemized:
            it === undefined
              ? undefined
              : it === null
                ? null
                : {
                    salesTaxElected: it.salesTaxElected,
                    line5d: amountCents(it.line5d),
                    line5e: amountCents(it.line5e),
                    line17: amountCents(it.line17),
                  },
          ageOrBlindBoxes: prior.ageOrBlindBoxes ?? 0,
        }
      : null,
  };
}

/** The 2024 package included a state return Tidy read (so its refund, even "none", is known). */
const stateReturnRead = (prior: PriorYearExtractionT | null) => Boolean(prior?.stateTotalTax && prior.stateTotalTax.amount !== null);

/** Whether the 2024 refund amount is known from documents (1099-Gs, or a 2024 state return that was read). */
export const refundKnownFromDocuments = (f: TaxFacts, prior: PriorYearExtractionT | null): boolean =>
  (f.f1099G ?? []).some((g) => g.box2StateRefund > 0) || stateReturnRead(prior);

/** What makes two forms the same form: who issued it, who it's for, and its main amounts. */
export function formSignature(x: Extraction): string | null {
  const n = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = (v: AmountT) => String(amountCents(v));
  switch (x.form) {
    case 'w2':
      return ['w2', n(x.data.employerName), n(x.data.employeeName), a(x.data.box1Wages), a(x.data.box2FedWithheld)].join('|');
    case 'f1099_int':
      return ['int', n(x.data.payerName), n(x.data.recipientName), a(x.data.box1Interest), a(x.data.box3UsTreasuryInterest)].join('|');
    case 'f1099_div':
      return [
        'div',
        n(x.data.payerName),
        n(x.data.recipientName),
        a(x.data.box1aOrdinaryDividends),
        a(x.data.box2aCapitalGainDistributions),
      ].join('|');
    case 'f1099_r':
      return [
        'r',
        n(x.data.payerName),
        n(x.data.recipientName),
        a(x.data.box1GrossDistribution),
        a(x.data.box2aTaxableAmount),
        x.data.box7Codes,
      ].join('|');
    case 'f1099_nec':
      return ['nec', n(x.data.payerName), n(x.data.recipientName), a(x.data.box1NonemployeeCompensation)].join('|');
    case 'ssa_1099':
      return ['ssa', n(x.data.recipientName), a(x.data.box5NetBenefits)].join('|');
    case 'f1099_b':
      return ['b', n(x.data.payerName), n(x.data.recipientName), x.data.lots.length, x.data.lots.map((l) => a(l.proceeds)).join(',')].join(
        '|',
      );
    case 'f1098':
      return ['1098', n(x.data.lenderName), a(x.data.box1MortgageInterest)].join('|');
    case 'k1':
      return [
        'k1',
        n(x.data.entityName),
        n(x.data.recipientName),
        a(x.data.ordinaryBusinessIncome),
        a(x.data.netRentalRealEstateIncome),
      ].join('|');
    case 'f1099_g':
      return ['g', n(x.data.payerName), n(x.data.recipientName), a(x.data.box1Unemployment), a(x.data.box2StateRefund)].join('|');
    case 'f1099_oid':
      return [
        'oid',
        n(x.data.payerName),
        n(x.data.recipientName),
        a(x.data.box1OriginalIssueDiscount),
        a(x.data.box2OtherPeriodicInterest),
      ].join('|');
    default:
      return null;
  }
}

function evidence(doc: DocumentRecord, idx: number, path: string, a: AmountT): Evidence {
  const firstPage = doc.extractions[idx]?.firstPage ?? 1;
  const page = a.page === null ? null : firstPage + a.page - 1;
  return { docId: doc.id, page, quote: a.quote, verified: doc.fieldChecks[`${idx}:${path}`] === 'verified' };
}

/** Whose form this is on a joint (or separate) return, from the name and SSN printed on it; null when the form doesn't
 *  say clearly (neither name, both names, or no names known yet). Single filers: always the taxpayer. */
export function ownerOf(f: TaxFacts, name: string, ssnLast4: string | null): Owner | null {
  if (!f.spouse || (f.filingStatus !== 'mfj' && f.filingStatus !== 'mfs')) return 'taxpayer';
  const last4 = (ssnLast4 ?? '').replace(/\D/g, '');
  if (last4.length === 4) {
    const you = f.taxpayer.ssn.endsWith(last4);
    const spouse = f.spouse.ssn.endsWith(last4);
    if (you !== spouse) return you ? 'taxpayer' : 'spouse';
  }
  const words = name
    .toLowerCase()
    .split(/[^a-z’'-]+/)
    .filter(Boolean);
  const first = (p: Person) => p.firstName.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const [you, spouse] = [first(f.taxpayer), first(f.spouse)];
  const hasYou = you !== '' && words.includes(you);
  const hasSpouse = spouse !== '' && spouse !== you && words.includes(spouse);
  if (hasYou !== hasSpouse) return hasYou ? 'taxpayer' : 'spouse';
  return null;
}

/** Accounts often in both names (interest, dividends, brokerage): both names means a joint account, kept with the
 *  taxpayer rather than asked about. */
const JOINT_OK = new Set(['f1099_int', 'f1099_div', 'f1099_b', 'f1099_oid', 'f1099_misc']);

/** The person a form is made out to, for forms that belong to one person. */
export function recipientOf(x: Extraction): { name: string; ssnLast4: string | null } | null {
  switch (x.form) {
    case 'w2':
      return { name: x.data.employeeName, ssnLast4: x.data.employeeSsnLast4 };
    case 'f1099_int':
    case 'f1099_div':
    case 'f1099_b':
    case 'f1099_oid':
    case 'f1099_misc':
      return { name: x.data.recipientName, ssnLast4: null };
    case 'f1099_r':
    case 'f1099_nec':
    case 'f1099_g':
    case 'ssa_1099':
    case 'k1':
      return { name: x.data.recipientName, ssnLast4: x.data.recipientSsnLast4 };
    default:
      return null;
  }
}

/** Forms whose owner Tidy can't tell, once both names are known: each becomes a question (see reconcile). */
export function unclearOwners(state: AppState, f: TaxFacts): { itemId: string; doc: DocumentRecord; x: Extraction; name: string }[] {
  if (!f.spouse || !f.spouse.firstName.trim() || !f.taxpayer.firstName.trim()) return [];
  const out: { itemId: string; doc: DocumentRecord; x: Extraction; name: string }[] = [];
  for (const doc of state.documents) {
    if (doc.status !== 'done' || doc.supersededBy || wrongYear(doc) !== null) continue;
    doc.extractions.forEach((x, i) => {
      const r = recipientOf(x);
      if (r && ownerOf(f, r.name, r.ssnLast4) === null && !(JOINT_OK.has(x.form) && bothNamed(f, r.name)))
        out.push({ itemId: `${x.form}-${doc.id}-${i}`, doc, x, name: r.name });
    });
  }
  return out;
}

function bothNamed(f: TaxFacts, name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z’'-]+/);
  const first = (p: Person | null) => p?.firstName.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return [first(f.taxpayer), first(f.spouse)].every((n) => n !== '' && words.includes(n));
}

/** Facts are DERIVED, never edited in place: documents → answers → overrides. Pure and idempotent. */
export function deriveFacts(state: AppState): TaxFacts {
  return deriveFactsChecked(state).facts;
}

/** `deriveFacts`, plus the accepted changes that no longer fit (set aside rather than applied). `overrides: false`
 *  works the return out without any of them. */
export function deriveFactsChecked(state: AppState, opts: { overrides?: boolean } = {}): { facts: TaxFacts; skipped: Override[] } {
  const f = documentAndAnswerFacts(state);
  return opts.overrides === false ? { facts: f, skipped: [...state.overrides] } : applyOverrides(f, state.overrides);
}

function documentAndAnswerFacts(state: AppState): TaxFacts {
  const f = emptyFacts();
  const prior = latestPriorYear(state);
  /** Settled after the answers (names, SSNs, filing status, where you live), which documents can't know. */
  const owned: { item: { owner: Owner }; id: string; form: string; name: string; ssnLast4: string | null }[] = [];
  const own = <T extends { owner: Owner }>(item: T, x: Extraction): T => {
    const r = recipientOf(x);
    if (r) owned.push({ item, id: (item as unknown as { id: string }).id, form: x.form, ...r });
    return item;
  };
  /** A mortgage statement or tax bill the user said is for a rental (asked only while a rental is rented out). */
  const rentalFor = (key: string) => {
    const to = state.questions.find((q) => q.id === `home-or-rental:${key}`)?.answer;
    return to && to !== 'home' ? (f.rentals ?? []).find((r) => r.id === to) : undefined;
  };
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
    f.payments.priorYearFederalAgi = amountCents(prior.agi);
    f.payments.priorYearFederalTax = amountCents(prior.totalTax);
    f.stateReturn.priorYearApplied = amountCents(prior.stateAppliedToNextYear);
    if (prior.stateTotalTax) {
      f.stateReturn.priorYearMdTax = amountCents(prior.stateTotalTax);
    }
    if (f.stateReturn.priorYearApplied > 0) {
      f.itemized.stateIncomeTaxPayments.push({ label: '2024 state refund applied to 2025', amount: f.stateReturn.priorYearApplied });
    }
    const charCarry = Math.abs(amountCents(prior.carryovers.charitable));
    f.carryovers = {
      capitalLossShortTerm: Math.abs(amountCents(prior.carryovers.capitalLossShortTerm)),
      capitalLossLongTerm: Math.abs(amountCents(prior.carryovers.capitalLossLongTerm)),
      qbiLoss: prior.carryovers.qbiLoss ? Math.abs(amountCents(prior.carryovers.qbiLoss)) : 0,
      reitPtpLoss: prior.carryovers.reitPtpLoss ? Math.abs(amountCents(prior.carryovers.reitPtpLoss)) : 0,
      charitable: charCarry,
      passiveLoss: Math.abs(amountCents(prior.carryovers.passiveLoss)),
      amtCredit: Math.abs(amountCents(prior.carryovers.amtCredit)),
      foreignTaxCredit: Math.abs(amountCents(prior.carryovers.foreignTaxCredit)),
      investmentInterest: Math.abs(amountCents(prior.carryovers.investmentInterest)),
    };
    if (charCarry > 0) {
      f.itemized.charityCarryover = charCarry;
    }
    if (prior.rentals && prior.rentals.length > 0) {
      f.rentals = prior.rentals.map((r, idx) => {
        const matchedPassive = (prior.passiveActivityCarryovers ?? []).find((p) => sameIssuer(p.activityName, r.address));
        const priorPassive = r.priorUnallowedPassiveLoss
          ? Math.abs(amountCents(r.priorUnallowedPassiveLoss))
          : matchedPassive
            ? Math.abs(amountCents(matchedPassive.unallowedLoss))
            : 0;
        return {
          id: `rental-prior-${idx}`,
          owner: 'taxpayer',
          address: r.address,
          propertyType: (r.propertyType ?? 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
          fairRentalDays: r.fairRentalDays ?? 365,
          personalUseDays: r.personalUseDays ?? 0,
          activeParticipation: r.activeParticipation ?? true,
          priorUnallowedPassiveLoss: priorPassive,
          rentsReceived: 0,
          expenses: {},
          depreciableAssets: (r.depreciableAssets ?? []).map((a) => ({
            description: a.description,
            placedInService: a.placedInService,
            basis: amountCents(a.basis),
            recoveryPeriodYears: a.recoveryPeriodYears ?? 27.5,
            placedInServiceIn2025: a.placedInService.endsWith('/2025'),
          })),
        };
      });
    }
    if (prior.mdDecoupling) {
      f.mdDecoupling = {
        federalDepreciation: amountCents(prior.mdDecoupling.federalDepreciation),
        mdDepreciationWithoutDecoupling: amountCents(prior.mdDecoupling.mdDepreciationWithoutDecoupling),
        pteDecouplingModification: prior.mdDecoupling.pteDecouplingModification
          ? amountCents(prior.mdDecoupling.pteDecouplingModification)
          : 0,
      };
    }
    if (prior.scheduleC) {
      f.scheduleC = [
        {
          id: 'schc-prior',
          owner: 'taxpayer',
          principalBusiness: prior.scheduleC.principalBusiness,
          businessCode: prior.scheduleC.businessCode ?? '541610',
          businessName: prior.scheduleC.businessName,
          ein: prior.scheduleC.ein,
          isSstb: true,
          expenses: {},
          homeOffice:
            prior.scheduleC.homeOfficeBusinessSqFt && prior.scheduleC.homeOfficeTotalSqFt
              ? {
                  method: 'simplified',
                  businessSqFt: prior.scheduleC.homeOfficeBusinessSqFt,
                  totalSqFt: prior.scheduleC.homeOfficeTotalSqFt,
                }
              : null,
        },
      ];
    }
  }

  for (const doc of state.documents) {
    if (doc.status !== 'done' || doc.supersededBy || wrongYear(doc) !== null) continue;
    const seen = new Set<string>();
    doc.extractions.forEach((x, i) => {
      // The same form twice in one file is its copies (B, C, 2): count it once. Across files, flags ask.
      const sig = formSignature(x);
      if (sig !== null && seen.has(sig)) return;
      if (sig !== null) seen.add(sig);
      const id = `${x.form}-${doc.id}-${i}`;
      const ev = (path: string, a: AmountT) => evidence(doc, i, path, a);
      switch (x.form) {
        case 'w2': {
          const d = x.data;
          f.w2s.push(
            own(
              {
                id,
                owner: 'taxpayer',
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
                  state: stateCode(s.state),
                  stateWages: amountCents(s.stateWages),
                  stateTax: amountCents(s.stateTax),
                })),
                localLines: d.localLines.map((s) => ({
                  locality: s.locality ?? '',
                  localWages: amountCents(s.localWages),
                  localTax: amountCents(s.localTax),
                })),
                evidence: { box1Wages: ev('box1Wages', d.box1Wages), box2FedWithheld: ev('box2FedWithheld', d.box2FedWithheld) },
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_int': {
          const d = x.data;
          f.f1099Int.push(
            own(
              {
                id,
                owner: 'taxpayer',
                payerName: d.payerName,
                box1Interest: amountCents(d.box1Interest),
                box3UsTreasuryInterest: amountCents(d.box3UsTreasuryInterest),
                box4FedWithheld: amountCents(d.box4FedWithheld),
                box6ForeignTaxPaid: amountCents(d.box6ForeignTaxPaid),
                box8TaxExemptInterest: amountCents(d.box8TaxExemptInterest),
                box9PrivateActivityBondInterest: amountCents(d.box9PrivateActivityBondInterest),
                evidence: { box1Interest: ev('box1Interest', d.box1Interest) },
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_div': {
          const d = x.data;
          f.f1099Div.push(
            own(
              {
                id,
                owner: 'taxpayer',
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
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_b': {
          const d = x.data;
          f.f1099B!.push(
            own(
              {
                id,
                owner: 'taxpayer',
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
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_r': {
          const d = x.data;
          f.f1099R!.push(
            own(
              {
                id,
                owner: 'taxpayer',
                payerName: d.payerName,
                payerEin: d.payerEin,
                box1GrossDistribution: amountCents(d.box1GrossDistribution),
                box2aTaxableAmount: amountCents(d.box2aTaxableAmount),
                box2aBlank: d.box2aTaxableAmount.amount === null,
                box2bTaxableNotDetermined: d.box2bTaxableNotDetermined,
                box2bTotalDistribution: d.box2bTotalDistribution,
                box4FedWithheld: amountCents(d.box4FedWithheld),
                box5EmployeeContributions: amountCents(d.box5EmployeeContributions),
                box7Codes: d.box7Codes.trim().toUpperCase(),
                iraSepSimple: d.box7IraSepSimple,
                stateLines: d.stateLines.map((s) => ({
                  state: stateCode(s.state),
                  stateTax: amountCents(s.stateTax),
                  stateDistribution: amountCents(s.stateDistribution),
                })),
                evidence: {
                  box1GrossDistribution: ev('box1GrossDistribution', d.box1GrossDistribution),
                  box2aTaxableAmount: ev('box2aTaxableAmount', d.box2aTaxableAmount),
                  box4FedWithheld: ev('box4FedWithheld', d.box4FedWithheld),
                },
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_nec': {
          const d = x.data;
          f.f1099Nec!.push(
            own(
              {
                id,
                owner: 'taxpayer',
                payerName: d.payerName,
                payerEin: d.payerEin,
                box1NonemployeeCompensation: amountCents(d.box1NonemployeeCompensation),
                box4FedWithheld: amountCents(d.box4FedWithheld),
                stateLines: d.stateLines.map((s) => ({
                  state: stateCode(s.state),
                  stateTax: amountCents(s.stateTax),
                  stateIncome: amountCents(s.stateIncome),
                })),
                evidence: {
                  box1NonemployeeCompensation: ev('box1NonemployeeCompensation', d.box1NonemployeeCompensation),
                  box4FedWithheld: ev('box4FedWithheld', d.box4FedWithheld),
                },
              },
              x,
            ),
          );
          break;
        }
        case 'ssa_1099': {
          const d = x.data;
          const paid = amountCents(d.box3BenefitsPaid);
          const repaid = amountCents(d.box4BenefitsRepaid);
          const net = d.box5NetBenefits.amount !== null ? amountCents(d.box5NetBenefits) : paid - repaid;
          f.ssa1099!.push(
            own(
              {
                id,
                owner: 'taxpayer',
                box3BenefitsPaid: paid || Math.max(0, net),
                box4BenefitsRepaid: repaid,
                box5NetBenefits: net,
                box6FedWithheld: amountCents(d.box6FedWithheld),
                medicarePremiums: d.medicarePremiums ? Math.abs(amountCents(d.medicarePremiums)) : 0,
                evidence: {
                  box5NetBenefits: ev('box5NetBenefits', d.box5NetBenefits),
                  box6FedWithheld: ev('box6FedWithheld', d.box6FedWithheld),
                },
              },
              x,
            ),
          );
          break;
        }
        case 'k1': {
          const d = x.data;
          const dists = amountCents(d.distributions);
          const nonded = amountCents(d.nondeductibleExpenses);
          const matchedPassive = (prior?.passiveActivityCarryovers ?? []).find((p) => sameIssuer(p.activityName, d.entityName));
          const priorPassive = matchedPassive ? Math.abs(amountCents(matchedPassive.unallowedLoss)) : 0;
          f.k1s!.push(
            own(
              {
                id,
                owner: 'taxpayer',
                entityType: d.entityType,
                entityName: d.entityName,
                entityEin: d.entityEin ?? '',
                isMaterialParticipation: false,
                ...(priorPassive > 0 ? { priorUnallowedPassiveLoss: priorPassive } : {}),
                ordinaryBusinessIncome: amountCents(d.ordinaryBusinessIncome),
                netRentalRealEstateIncome: amountCents(d.netRentalRealEstateIncome),
                otherNetRentalIncome: amountCents(d.otherNetRentalIncome),
                guaranteedPayments: amountCents(d.guaranteedPayments),
                interestIncome: amountCents(d.interestIncome),
                ordinaryDividends: amountCents(d.ordinaryDividends),
                qualifiedDividends: amountCents(d.qualifiedDividends),
                royalties: amountCents(d.royalties),
                netShortTermCapitalGain: amountCents(d.netShortTermCapitalGain),
                netLongTermCapitalGain: amountCents(d.netLongTermCapitalGain),
                collectibles28Gain: amountCents(d.collectibles28Gain),
                unrecaptured1250Gain: amountCents(d.unrecaptured1250Gain),
                netSection1231Gain: amountCents(d.netSection1231Gain),
                section179Deduction: amountCents(d.section179Deduction),
                selfEmploymentEarnings: amountCents(d.selfEmploymentEarnings),
                qbiAmount: amountCents(d.qbiAmount),
                qbiW2Wages: amountCents(d.qbiW2Wages),
                qbiUbia: amountCents(d.qbiUbia),
                ...(d.entityType === '1120S' &&
                (dists > 0 || nonded > 0 || amountCents(d.ordinaryBusinessIncome) < 0 || amountCents(d.netRentalRealEstateIncome) < 0)
                  ? {
                      sCorpBasis: {
                        beginningStockBasis: 0,
                        distributions: dists,
                        nondeductibleExpenses: nonded,
                      },
                    }
                  : {}),
                evidence: {
                  ordinaryBusinessIncome: ev('ordinaryBusinessIncome', d.ordinaryBusinessIncome),
                  netRentalRealEstateIncome: ev('netRentalRealEstateIncome', d.netRentalRealEstateIncome),
                },
              },
              x,
            ),
          );
          break;
        }
        case 'f1098': {
          const rental = rentalFor(`${doc.id}-${i}`);
          if (rental) {
            const e = rental.expenses;
            rental.expenses = {
              ...e,
              mortgageInterest: (e.mortgageInterest ?? 0) + amountCents(x.data.box1MortgageInterest),
              taxes: (e.taxes ?? 0) + amountCents(x.data.realEstateTaxPaid),
            };
          } else {
            f.itemized.mortgageInterest1098 += amountCents(x.data.box1MortgageInterest);
            f.itemized.realEstateTax += amountCents(x.data.realEstateTaxPaid);
          }
          break;
        }
        case 'payment': {
          const d = x.data;
          const amt = amountCents(d.amount);
          const inYear = d.datePaid === null || d.datePaid.startsWith('2025');
          const rental = d.kind === 'property_tax' ? rentalFor(`${doc.id}-${i}`) : undefined;
          if (rental && inYear) rental.expenses = { ...rental.expenses, taxes: (rental.expenses.taxes ?? 0) + amt };
          else if (d.kind === 'property_tax' && inYear) f.itemized.realEstateTax += amt;
          if (d.kind === 'charity_cash' && inYear) f.itemized.charityCash += amt;
          if (d.kind === 'charity_noncash' && inYear) f.itemized.charityNonCash += amt;
          // Estimated tax records only fill in the payments questions; the user's answers count (see estimates.ts).
          break;
        }
        case 'f1099_oid': {
          // Original issue discount is interest. (Market discount and acquisition premium adjustments block: flags.)
          const d = x.data;
          f.f1099Int.push(
            own(
              {
                id,
                owner: 'taxpayer',
                payerName: `${d.payerName} (OID)`,
                box1Interest: amountCents(d.box1OriginalIssueDiscount) + amountCents(d.box2OtherPeriodicInterest),
                box3UsTreasuryInterest: amountCents(d.box8OidOnTreasury),
                box4FedWithheld: amountCents(d.box4FedWithheld),
                box6ForeignTaxPaid: 0,
                box8TaxExemptInterest: amountCents(d.box11TaxExemptOid),
                box9PrivateActivityBondInterest: 0,
                evidence: { box1Interest: ev('box1OriginalIssueDiscount', d.box1OriginalIssueDiscount) },
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_g': {
          const d = x.data;
          f.f1099G!.push(
            own(
              {
                id,
                owner: 'taxpayer',
                payerName: d.payerName,
                box1Unemployment: amountCents(d.box1Unemployment),
                box2StateRefund: amountCents(d.box2StateRefund),
                box3TaxYear: d.box3TaxYear,
                box4FedWithheld: amountCents(d.box4FedWithheld),
                otherBoxes: d.otherBoxes ? amountCents(d.otherBoxes) : 0,
                stateLines: d.stateLines.map((s) => ({ state: stateCode(s.state), stateTax: amountCents(s.stateTax) })),
                evidence: {
                  box1Unemployment: ev('box1Unemployment', d.box1Unemployment),
                  box2StateRefund: ev('box2StateRefund', d.box2StateRefund),
                  box4FedWithheld: ev('box4FedWithheld', d.box4FedWithheld),
                },
              },
              x,
            ),
          );
          break;
        }
        case 'f1099_misc': // nothing Tidy reports yet: any amount on it blocks (flags)
        case 'prior_year':
        case 'prior_state':
          break;
      }
    });
  }

  f.stateRefund = priorStateRefund(f, prior);

  for (const q of state.questions) {
    if (q.origin !== 'rule' || q.answer === null) continue;
    const rule = RULES.find((r) => r.id === q.id);
    if (rule) rule.apply(q.answer, f, prior);
    else {
      const item = itemRuleOf(q.id);
      item?.rule.apply(q.answer, f, item.key);
    }
  }

  // Now that names, SSNs and filing status are known: whose each form is (the user's answer when Tidy had to ask).
  for (const o of owned) {
    const answer = state.questions.find((q) => q.id === `owner:${o.id}`)?.answer;
    o.item.owner = answer === 'taxpayer' || answer === 'spouse' ? answer : (ownerOf(f, o.name, o.ssnLast4) ?? 'taxpayer');
  }

  return f;
}
