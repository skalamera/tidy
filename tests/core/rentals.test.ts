import { describe, expect, it } from 'vitest';
import { deriveFacts } from '../../src/core/deriveFacts';
import { buildView } from '../../src/core/view';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd } from '../../src/engine/money';
import type { AppState, Extraction } from '../../src/shared/state';
import { amt, answered, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const RENTAL = 'rental-prior-0';
const withRental = (more: Extraction[] = []): AppState =>
  stateWith({
    documents: [
      doc('py', [
        priorYear({
          rentals: [
            {
              address: '9 Elm St, Rockville, MD 20850',
              propertyType: 1,
              fairRentalDays: 365,
              personalUseDays: 0,
              activeParticipation: true,
              depreciableAssets: [
                { description: 'House', placedInService: '06/2015', basis: amt('275,000.00'), recoveryPeriodYears: 27.5 },
              ],
            },
          ],
        }),
      ]),
      doc('d1', [w2Extraction(), ...more]),
    ],
  });
const ids = (s: AppState) => s.questions.map((q) => q.id);
const flagIds = (s: AppState) => buildView(s, { aiProvider: null }).flags.map((f) => f.id);

const RENTED = {
  [`rental-status:${RENTAL}`]: 'rented',
  [`rental-income:${RENTAL}`]: String(usd(24_000)),
  [`rental-expenses:${RENTAL}`]: JSON.stringify({
    insurance: usd(1_200),
    repairs: usd(800),
    taxes: usd(3_000),
    mortgageInterest: usd(6_000),
  }),
  [`rental-full-year:${RENTAL}`]: 'yes',
  [`rental-participation:${RENTAL}`]: 'yes',
  [`rental-qbi:${RENTAL}`]: 'no',
};

describe('rentals carried from the 2024 return', () => {
  it('asks what happened to each rental, then its rent, expenses, days and participation', () => {
    const s = answered(withRental(), {});
    expect(ids(s)).toContain(`rental-status:${RENTAL}`);
    expect(ids(s)).not.toContain(`rental-income:${RENTAL}`);
    const rented = answered(s, { [`rental-status:${RENTAL}`]: 'rented' });
    for (const id of ['rental-income', 'rental-expenses', 'rental-full-year', 'rental-participation', 'rental-qbi'])
      expect(ids(rented)).toContain(`${id}:${RENTAL}`);
    expect(rented.questions.find((q) => q.id === `rental-expenses:${RENTAL}`)).toMatchObject({
      kind: 'lines',
      sectionId: 'wages',
      blocking: true,
    });
  });

  it('puts the answers on Schedule E instead of a phantom loss', () => {
    const s = answered(withRental(), RENTED);
    const r = deriveFacts(s).rentals![0];
    expect(r).toMatchObject({
      rentsReceived: usd(24_000),
      fairRentalDays: 365,
      personalUseDays: 0,
      activeParticipation: true,
      qualifiesForQbi: false,
      expenses: { insurance: usd(1_200), repairs: usd(800), taxes: usd(3_000), mortgageInterest: usd(6_000) },
    });
    const fed = computeFederal(deriveFacts(s));
    expect(fed.ledger.get('schE.3.A')).toBe(usd(24_000));
    expect(fed.ledger.get('schE.18.A')).toBe(usd(9_999)); // 275,000 × 3.636% (Pub 946 Table A-6, year 11, June)
    expect(fed.ledger.get('schE.21.A')).toBe(usd(24_000 - 1_200 - 800 - 3_000 - 6_000 - 9_999));
    expect(flagIds(s).filter((id) => id.startsWith('rental'))).toEqual([]);
  });

  it('asks for the days when it wasn’t rented all year, and blocks vacation-home use', () => {
    const s = answered(withRental(), { ...RENTED, [`rental-full-year:${RENTAL}`]: 'no' });
    expect(s.questions.find((q) => q.id === `rental-days:${RENTAL}`)).toMatchObject({ kind: 'counts' });
    const ok = answered(s, { [`rental-days:${RENTAL}`]: JSON.stringify({ fairRentalDays: 300, personalUseDays: 10 }) });
    expect(deriveFacts(ok).rentals![0]).toMatchObject({ fairRentalDays: 300, personalUseDays: 10 });
    expect(flagIds(ok)).not.toContain(`rental-vacation:${RENTAL}`);
    const vacation = answered(s, { [`rental-days:${RENTAL}`]: JSON.stringify({ fairRentalDays: 100, personalUseDays: 30 }) });
    expect(flagIds(vacation)).toContain(`rental-vacation:${RENTAL}`);
  });

  it('blocks a rental that was sold or stopped being rented', () => {
    expect(flagIds(answered(withRental(), { [`rental-status:${RENTAL}`]: 'sold' }))).toContain(`rental-sold:${RENTAL}`);
    expect(flagIds(answered(withRental(), { [`rental-status:${RENTAL}`]: 'stopped' }))).toContain(`rental-stopped:${RENTAL}`);
  });

  it('moves a rental’s Form 1098 to Schedule E when the user says it is for the rental', () => {
    const f1098: Extraction = {
      form: 'f1098',
      firstPage: 1,
      data: {
        lenderName: 'Rental Bank',
        box1MortgageInterest: amt('5,000.00'),
        box2OutstandingPrincipal: amt(null),
        realEstateTaxPaid: amt('2,000.00'),
        propertyAddress: null,
      },
    };
    const s = answered(withRental([f1098]), { ...RENTED, [`rental-expenses:${RENTAL}`]: JSON.stringify({ insurance: usd(1_200) }) });
    const q = s.questions.find((x) => x.id === 'home-or-rental:d1-1');
    expect(q?.choices?.map((c) => c.value)).toEqual(['home', RENTAL]);
    expect(deriveFacts(s).itemized.mortgageInterest1098).toBe(usd(5_000)); // not answered yet: the home, as before
    const f = deriveFacts(answered(s, { 'home-or-rental:d1-1': RENTAL }));
    expect(f.itemized.mortgageInterest1098).toBe(0);
    expect(f.itemized.realEstateTax).toBe(0);
    expect(f.rentals![0].expenses).toMatchObject({ mortgageInterest: usd(5_000), taxes: usd(2_000), insurance: usd(1_200) });
  });
});

describe('rentals Tidy doesn’t know about', () => {
  it('asks everyone, and blocks a rental that isn’t on the 2024 return', () => {
    const s = answered(withRental(), { ...RENTED, 'rentals-other': 'yes' });
    expect(s.questions.find((q) => q.id === 'rentals-other')?.prompt).toBe(
      'Besides 9 Elm St, Rockville, MD 20850, did you own any other rental property, or get royalties, in 2025?',
    );
    const v = buildView(s, { aiProvider: null });
    expect(v.flags.find((f) => f.id === 'rental-unknown')?.title).toBe('Tidy can’t add a rental that wasn’t on your 2024 return yet');

    const none = stateWith({ documents: [doc('d1', [w2Extraction()])] });
    none.onboarding.priorYearSkipped = true;
    const asked = answered(none, { 'rentals-other': 'yes' });
    expect(asked.questions.find((q) => q.id === 'rentals-other')?.prompt).toBe('Did you own rental property, or get royalties, in 2025?');
    expect(buildView(asked, { aiProvider: null }).flags.find((f) => f.id === 'rental-unknown')?.title).toBe(
      'Add your 2024 return to report a rental',
    );
  });
});
