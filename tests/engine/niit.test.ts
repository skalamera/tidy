import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import type { ScheduleK1 } from '../../src/shared/facts';
import { facts, int1099, r1099, w2 } from '../fixtures/facts';

const k1 = (p: Partial<ScheduleK1> & Pick<ScheduleK1, 'id' | 'entityName'>): ScheduleK1 => ({
  owner: 'taxpayer',
  entityType: '1065',
  entityEin: '12-3456789',
  ordinaryBusinessIncome: 0,
  netRentalRealEstateIncome: 0,
  interestIncome: 0,
  ordinaryDividends: 0,
  qualifiedDividends: 0,
  netShortTermCapitalGain: 0,
  netLongTermCapitalGain: 0,
  netSection1231Gain: 0,
  ...p,
});

describe('Form 8960 with rentals, K-1s and annuities', () => {
  it('counts passive income, rentals and nonqualified annuities; leaves out nonpassive business income', () => {
    const f = facts({
      filingStatus: 'mfj',
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: null },
      w2s: [w2({ box1Wages: usd(300_000) })],
      f1099Int: [int1099({ box1Interest: usd(10_000) })],
      f1099R: [r1099({ box1GrossDistribution: usd(5_000), box2aTaxableAmount: usd(5_000), box7Codes: 'D' })],
      rentals: [
        {
          id: 'r1',
          owner: 'taxpayer',
          address: '9 Elm St, Rockville, MD 20850',
          propertyType: 1,
          fairRentalDays: 365,
          personalUseDays: 0,
          rentsReceived: usd(60_000),
          expenses: { repairs: usd(20_000) },
        },
      ],
      k1s: [
        k1({
          id: 'mp',
          entityName: 'Our Shop LLC',
          isMaterialParticipation: true,
          ordinaryBusinessIncome: usd(100_000),
          guaranteedPayments: usd(20_000),
        }),
        k1({ id: 'pass', entityName: 'Fund LP', isMaterialParticipation: false, ordinaryBusinessIncome: usd(10_000) }),
      ],
    });
    const r = computeFederal(f);
    expect(r.ledger.get('f8960.1')).toBe(usd(10_000));
    expect(r.ledger.get('f8960.3')).toBe(usd(5_000));
    expect(r.ledger.get('f8960.4a')).toBe(usd(170_000));
    expect(r.ledger.get('f8960.4b')).toBe(usd(-120_000));
    expect(r.ledger.get('f8960.4c')).toBe(usd(50_000));
    expect(r.ledger.get('f8960.8')).toBe(usd(65_000));
    expect(r.ledger.get('f8960.9b')).toBe(0); // standard deduction: no state income tax to allocate
    expect(r.ledger.get('f8960.17')).toBe(usd(2_470));
  });
});
