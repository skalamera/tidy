import { describe, expect, it } from 'vitest';
import { deriveFacts } from '../../src/core/deriveFacts';
import { buildView } from '../../src/core/view';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd } from '../../src/engine/money';
import { normalAnswer } from '../../src/shared/answers';
import type { K1ExtractionT } from '../../src/shared/schemas/extraction';
import type { AppState, Extraction } from '../../src/shared/state';
import { amt, answered, doc, priorYear, r1099Extraction, ssa1099Extraction, stateWith, w2Extraction } from '../fixtures/state';

const ids = (s: AppState) => s.questions.map((q) => q.id);
const flagIds = (s: AppState) => buildView(s, { aiProvider: null }).flags.map((f) => f.id);
const k1 = (entityName: string, p: Partial<K1ExtractionT> = {}): Extraction => ({
  form: 'k1',
  firstPage: 1,
  data: {
    entityType: '1065',
    entityName,
    entityEin: '52-1234567',
    recipientName: 'Alex Rivera',
    recipientSsnLast4: null,
    ordinaryBusinessIncome: amt('10,000.00'),
    netRentalRealEstateIncome: amt(null),
    otherNetRentalIncome: amt(null),
    guaranteedPayments: amt(null),
    interestIncome: amt(null),
    ordinaryDividends: amt(null),
    qualifiedDividends: amt(null),
    royalties: amt(null),
    netShortTermCapitalGain: amt(null),
    netLongTermCapitalGain: amt(null),
    collectibles28Gain: amt(null),
    unrecaptured1250Gain: amt(null),
    netSection1231Gain: amt(null),
    section179Deduction: amt(null),
    selfEmploymentEarnings: amt(null),
    distributions: amt(null),
    nondeductibleExpenses: amt(null),
    qbiAmount: amt('10,000.00'),
    qbiW2Wages: amt(null),
    qbiUbia: amt(null),
    ...p,
  },
});

describe('dates of birth', () => {
  it('are asked of each person and stored as given, so ages print right', () => {
    expect(normalAnswer({ kind: 'date', choices: null }, '4/27/1958')).toBe('1958-04-27');
    expect(normalAnswer({ kind: 'date', choices: null }, '02/30/1958')).toBeNull();
    expect(normalAnswer({ kind: 'date', choices: null }, '1958-04-27')).toBe('1958-04-27');
    const s = answered(stateWith({ documents: [doc('py', [priorYear()])] }), {
      'filing-status-same': 'yes',
      'your-birth-date': '1958-04-27',
      'spouse-birth-date': '1962-03-01',
    });
    const f = deriveFacts(s);
    expect([f.taxpayer.dateOfBirth, f.spouse?.dateOfBirth]).toEqual(['1958-04-27', '1962-03-01']);
    const r = computeFederal(f);
    expect(r.line12d).toMatchObject({ you65: true, spouse65: false });
    expect(ids(s)).not.toContain('you-65');
  });
});

describe('situations Tidy can’t prepare yet block export', () => {
  it('head of household, foreign accounts, W-2 box 12 code W, and another state’s withholding', () => {
    const s = answered(
      stateWith({
        documents: [
          doc('py', [priorYear()]),
          doc('w', [
            w2Extraction({
              box12: [{ code: 'W', amount: amt('1,200.00') }],
              stateLines: [{ state: 'Virginia', stateWages: amt('85,000.00'), stateTax: amt('2,100.00') }],
            }),
          ]),
        ],
      }),
      { 'filing-status-same': 'no', 'filing-status': 'hoh', 'foreign-accounts': 'yes' },
    );
    expect(flagIds(s)).toEqual(
      expect.arrayContaining([
        'filing-status-qualifying-person',
        'foreign-accounts',
        expect.stringMatching(/^w2-box12:.*:W$/),
        expect.stringMatching(/^other-state-tax:W-2 from .*:VA$/),
      ]),
    );
  });
});

describe('1099-Rs', () => {
  it('treat an IRA with box 2a blank as fully taxable, and block only a pension that doesn’t say', () => {
    const s = answered(
      stateWith({
        documents: [
          doc('py', [priorYear()]),
          doc('ira', [
            r1099Extraction({
              payerName: 'Vanguard',
              box7IraSepSimple: true,
              box2aTaxableAmount: amt(null),
              box2bTaxableNotDetermined: true,
            }),
          ]),
          doc('pen', [
            r1099Extraction({
              payerName: 'Acme Pension',
              box7IraSepSimple: false,
              box2aTaxableAmount: amt(null),
              box2bTaxableNotDetermined: true,
            }),
          ]),
        ],
      }),
      {},
    );
    const blocked = flagIds(s).filter((id) => id.startsWith('1099r-undetermined'));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toContain('pen');
    expect(ids(s)).toContain('ira-qcd'); // the IRA is taxable now, so QCDs and rollovers are asked
  });

  it('ask what kind of plan paid a pension, and the PSO premiums only for public safety plans', () => {
    const s0 = answered(
      stateWith({
        documents: [
          doc('py', [priorYear()]),
          doc('pen', [r1099Extraction({ payerName: 'County Police Pension', box7IraSepSimple: false })]),
        ],
      }),
      {},
    );
    const q = s0.questions.find((x) => x.id.startsWith('pension-kind:'))!;
    expect(q.prompt).toBe('What kind of plan paid your 1099-R from County Police Pension?');
    expect(ids(s0).some((id) => id.startsWith('pension-pso:'))).toBe(false);
    const s1 = answered(s0, { [q.id]: 'public_safety' });
    const pso = s1.questions.find((x) => x.id.startsWith('pension-pso:'))!;
    const s2 = answered(s1, { [pso.id]: String(usd(4_000)) });
    const r = deriveFacts(s2).f1099R![0]!;
    expect(r).toMatchObject({ mdSource: 'public_safety', psoAmount: usd(4_000) });
    expect(computeFederal(deriveFacts(s2)).ledger.get('f1040.5b')).toBe(r.box2aTaxableAmount - usd(3_000)); // capped at $3,000
  });
});

describe('K-1 questions are asked per K-1', () => {
  it('participation and specified service for each business, and basis for an S corporation with a loss', () => {
    const s0 = answered(
      stateWith({
        documents: [
          doc('py', [priorYear()]),
          doc('a', [k1('Alpha Partners')]),
          doc('b', [k1('Beta S Corp', { entityType: '1120S', ordinaryBusinessIncome: amt('-8,000.00'), qbiAmount: amt('-8,000.00') })]),
        ],
      }),
      {},
    );
    const part = s0.questions.filter((q) => q.id.startsWith('k1-participation:'));
    expect(part.map((q) => q.prompt)).toEqual([
      'Did you work in the business of Alpha Partners for more than 500 hours in 2025, or take part in it regularly and substantially?',
      'Did you work in the business of Beta S Corp for more than 500 hours in 2025, or take part in it regularly and substantially?',
    ]);
    expect(s0.questions.filter((q) => q.id.startsWith('k1-sstb:'))).toHaveLength(2);
    const basis = s0.questions.find((q) => q.id.startsWith('k1-basis:'))!;
    const s1 = answered(s0, {
      [part[0]!.id]: 'yes',
      [part[1]!.id]: 'no',
      [s0.questions.find((q) => q.id.startsWith('k1-sstb:'))!.id]: 'yes',
      [basis.id]: JSON.stringify({ beginningStockBasis: usd(5_000), beginningDebtBasis: usd(1_000) }),
    });
    const [alpha, beta] = deriveFacts(s1).k1s!;
    expect(alpha).toMatchObject({ isMaterialParticipation: true, isSstb: true });
    expect(beta).toMatchObject({
      isMaterialParticipation: false,
      sCorpBasis: { beginningStockBasis: usd(5_000), beginningDebtBasis: usd(1_000) },
    });
  });
});

describe('medical expenses', () => {
  it('suggest the Medicare premiums from the SSA-1099 and cap long-term care premiums by age', () => {
    const s0 = answered(
      stateWith({ documents: [doc('py', [priorYear()]), doc('ssa', [ssa1099Extraction({ medicarePremiums: amt('2,220.00') })])] }),
      { 'filing-status-same': 'yes', 'your-birth-date': '1950-05-05', 'spouse-birth-date': '1980-05-05' },
    );
    const q = s0.questions.find((x) => x.id === 'medical-expenses')!;
    expect(q.suggestedLines).toEqual({ premiums: usd(2_220) });
    const s1 = answered(s0, {
      'medical-expenses': JSON.stringify({ premiums: usd(2_220), ltcYou: usd(9_000), ltcSpouse: usd(9_000), other: usd(30_000) }),
    });
    const r = computeFederal(deriveFacts(s1));
    // You are 75 ($6,020 limit) and your spouse 45 ($900 limit): $2,220 + $30,000 + $6,020 + $900.
    expect(r.ledger.get('schA.1')).toBe(usd(39_140));
  });
});

describe('a capital loss carryover', () => {
  it('is asked without a 2024 return even with no sales in 2025', () => {
    const s = answered(stateWith({ documents: [doc('w', [w2Extraction()])] }), {
      'capital-loss-carryover': 'yes',
      'capital-loss-carryover-lt': String(usd(9_000)),
    });
    expect(ids(s)).toContain('capital-loss-carryover');
    expect(computeFederal(deriveFacts(s)).ledger.get('f1040.7a')).toBe(-usd(3_000));
  });
});
