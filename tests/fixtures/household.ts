import { usd } from '../../src/engine/money';
import { MD_LOCAL_2025, type MdCounty } from '../../src/engine/params/md2025';
import type { CapitalLot, FilingStatus, RentalProperty, ScheduleK1, TaxFacts } from '../../src/shared/facts';
import { div1099, facts, int1099, r1099, ssa1099, w2 } from './facts';

/** Design rule 16: the engine never throws on a valid household. A seeded generator covers the input space
 *  (filing statuses, ages, every income type, carryovers, penalties, both tax years) so a fractional-cent bug in a
 *  rarely reached range (like the old Form 8995-A phase-in crash) fails here instead of in the app. */
function generator(seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const dollars = (max: number) => usd(Math.floor(rnd() * max));
  const signed = (max: number) => usd(Math.floor(rnd() * max * 2) - max);
  const maybe = <T>(p: number, make: () => T): T[] => (rnd() < p ? [make()] : []);
  return { rnd, pick, dollars, signed, maybe };
}

export function household(seed: number): TaxFacts {
  const g = generator(seed);
  const status: FilingStatus = g.pick(['single', 'mfj', 'mfj', 'mfs', 'hoh']);
  const joint = status === 'mfj';
  const dob = () => g.pick([null, '1950-03-03', '1959-12-31', '1961-01-02', '1985-05-05']);
  const lot = (): CapitalLot => ({
    description: '10 sh XYZ',
    dateAcquired: g.pick(['01/02/2020', 'VARIOUS', null]),
    dateSold: '06/01/2025',
    proceeds: g.dollars(300_000),
    costBasis: g.dollars(300_000),
    marketDiscount: g.pick([0, g.dollars(500)]),
    washSaleDisallowed: g.pick([0, 0, g.dollars(2_000)]),
    box: g.pick(['A', 'B', 'D', 'E'] as const),
    collectibles: g.rnd() < 0.05,
  });
  const rental = (): RentalProperty => ({
    id: `rent-${seed}`,
    owner: 'taxpayer',
    address: '9 Elm St, Rockville, MD 20850',
    propertyType: g.pick([1, 2, 4] as const),
    fairRentalDays: 365,
    personalUseDays: 0,
    activeParticipation: g.rnd() < 0.8,
    qualifiesForQbi: g.rnd() < 0.3,
    priorUnallowedPassiveLoss: g.pick([0, g.dollars(30_000)]),
    rentsReceived: g.dollars(60_000),
    expenses: { mortgageInterest: g.dollars(20_000), taxes: g.dollars(8_000), repairs: g.dollars(10_000), insurance: g.dollars(3_000) },
    depreciableAssets: [{ description: 'Building', placedInService: g.pick(['03/2015', '11/2024', '06/2025']), basis: g.dollars(500_000) }],
  });
  const k1 = (): ScheduleK1 => ({
    id: `k1-${seed}`,
    owner: g.pick(['taxpayer', joint ? 'spouse' : 'taxpayer'] as const),
    entityType: g.pick(['1065', '1065', '1120S', '1041'] as const),
    entityName: 'Fund LP',
    entityEin: '12-3456789',
    isMaterialParticipation: g.rnd() < 0.5,
    activeRentalParticipation: g.rnd() < 0.3,
    priorUnallowedPassiveLoss: g.pick([0, g.dollars(20_000)]),
    ordinaryBusinessIncome: g.signed(150_000),
    netRentalRealEstateIncome: g.signed(40_000),
    interestIncome: g.dollars(3_000),
    ordinaryDividends: g.dollars(3_000),
    qualifiedDividends: 0,
    netShortTermCapitalGain: g.signed(10_000),
    netLongTermCapitalGain: g.signed(30_000),
    netSection1231Gain: g.signed(10_000),
    selfEmploymentEarnings: g.pick([0, g.dollars(100_000)]),
    qbiAmount: g.signed(150_000),
    qbiW2Wages: g.dollars(80_000),
    qbiUbia: g.dollars(400_000),
    qbiReitDividends: g.pick([0, g.dollars(2_000)]),
    isSstb: g.rnd() < 0.3,
  });
  return facts({
    taxYear: g.pick([2025, 2025, 2026] as const),
    filingStatus: status,
    taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: dob(), blind: g.rnd() < 0.05 },
    spouse: joint || status === 'mfs' ? { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: dob() } : null,
    residency: { state: 'MD', fullYear: true, mdCounty: g.pick(Object.keys(MD_LOCAL_2025) as MdCounty[]), mdSubdivision: null },
    w2s: g.maybe(0.6, () =>
      w2({
        box1Wages: g.dollars(700_000),
        box2FedWithheld: g.dollars(90_000),
        box3SsWages: g.dollars(200_000),
        box5MedicareWages: g.dollars(700_000),
        box6MedicareWithheld: g.dollars(10_000),
        stateLines: [{ state: 'MD', stateWages: 0, stateTax: g.dollars(30_000) }],
      }),
    ),
    f1099Int: g.maybe(0.7, () =>
      int1099({
        box1Interest: g.dollars(40_000),
        box8TaxExemptInterest: g.dollars(5_000),
        box9PrivateActivityBondInterest: g.dollars(800),
      }),
    ),
    f1099Div: g.maybe(0.7, () => {
      const ord = g.dollars(80_000);
      return div1099({
        box1aOrdinaryDividends: ord,
        box1bQualifiedDividends: Math.floor((ord * g.rnd()) / 100) * 100,
        box2aCapitalGainDistributions: g.dollars(200_000),
        box5Section199aDividends: g.pick([0, g.dollars(6_000)]),
      });
    }),
    f1099B: g.maybe(0.5, () => ({
      id: `b-${seed}`,
      owner: 'taxpayer' as const,
      payerName: 'Broker',
      box4FedWithheld: 0,
      lots: [lot(), lot(), lot()],
      evidence: {},
    })),
    f1099R: g.maybe(0.5, () => {
      const gross = g.dollars(150_000);
      return r1099({
        box1GrossDistribution: gross,
        box2aTaxableAmount: gross,
        box4FedWithheld: g.dollars(15_000),
        iraSepSimple: g.rnd() < 0.5,
        box7Codes: g.pick(['7', '7', 'G', '4']),
      });
    }),
    ssa1099: g.maybe(0.4, () => ssa1099({ box5NetBenefits: g.dollars(60_000) })),
    f1099Nec: g.maybe(0.3, () => ({
      id: `n-${seed}`,
      owner: 'taxpayer' as const,
      payerName: 'Client',
      payerEin: null,
      box1NonemployeeCompensation: g.dollars(300_000),
      box4FedWithheld: 0,
      stateLines: [],
      evidence: {},
    })),
    rentals: g.maybe(0.35, rental),
    k1s: g.maybe(0.35, k1),
    carryovers: {
      capitalLossShortTerm: g.pick([0, g.dollars(20_000)]),
      capitalLossLongTerm: g.pick([0, g.dollars(20_000)]),
      qbiLoss: g.pick([0, 0, g.dollars(50_000)]),
      reitPtpLoss: g.pick([0, 0, g.dollars(3_000)]),
    },
    itemized: {
      medicalExpenses: g.dollars(30_000),
      stateIncomeTaxPayments: [{ label: 'Estimated', amount: g.dollars(20_000) }],
      realEstateTax: g.dollars(15_000),
      personalPropertyTax: 0,
      mortgageInterest1098: g.dollars(40_000),
      investmentInterest: 0,
      charityCash: g.dollars(30_000),
      charityNonCash: g.dollars(5_000),
      charityCarryover: g.pick([0, g.dollars(10_000)]),
    },
    payments: {
      federalEstimated: [g.dollars(30_000)],
      federalPriorYearApplied: g.pick([0, g.dollars(3_000)]),
      federalExtensionPayment: 0,
      priorYearFederalAgi: g.dollars(500_000),
      priorYearFederalTax: g.dollars(100_000),
      computeForm2210: g.rnd() < 0.5,
    },
    stateReturn: {
      homeStateMuniInterest: 0,
      estimatedPayments: [g.dollars(10_000)],
      priorYearApplied: 0,
      extensionPayment: 0,
      priorYearMdTax: g.dollars(30_000),
      computeForm502UP: g.rnd() < 0.5,
    },
  });
}
