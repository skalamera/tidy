import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeAssetDepreciation, readPlacedInService } from '../../src/engine/federal/scheduleE';
import { computeMd } from '../../src/engine/md/form502';
import { usd } from '../../src/engine/money';
import type { RentalProperty, ScheduleK1 } from '../../src/shared/facts';
import { facts, r1099, w2 } from '../fixtures/facts';

const asset = (placedInService: string, basis: number, recoveryPeriodYears?: number) => ({
  description: 'Asset',
  placedInService,
  basis,
  ...(recoveryPeriodYears ? { recoveryPeriodYears } : {}),
});

describe('rental depreciation follows the Publication 946 tables, and stops', () => {
  it('uses Table A-6 by recovery year, and nothing once 27.5 years are used up', () => {
    // Table A-6 alternates after year 9: for January–June property, even years are 3.637% and odd years 3.636%.
    expect(computeAssetDepreciation(asset('06/2015', usd(100_000)), 2025).deduction).toBe(usd(3_636)); // year 11
    expect(computeAssetDepreciation(asset('06/2016', usd(100_000)), 2025).deduction).toBe(usd(3_637)); // year 10
    expect(computeAssetDepreciation(asset('09/2016', usd(100_000)), 2025).deduction).toBe(usd(3_636)); // year 10, September
    // July 1996: year 30 in 2025, past the end of the table.
    expect(computeAssetDepreciation(asset('07/1996', usd(100_000)), 2025).deduction).toBe(0);
    // March 1998: year 28, the last partial year for March (2.576%).
    expect(computeAssetDepreciation(asset('03/1998', usd(100_000)), 2025).deduction).toBe(usd(2_576));
  });

  it('uses Table A-7a for 39-year property and Table A-1 for 5- and 7-year property', () => {
    expect(computeAssetDepreciation(asset('01/2020', usd(100_000), 39), 2025).deduction).toBe(usd(2_564));
    // 5-year property placed in service in 2023: 2025 is year 3, 19.20% (not straight line).
    expect(computeAssetDepreciation(asset('05/2023', usd(10_000), 5), 2025).deduction).toBe(usd(1_920));
    // 7-year property from 2016: year 10, past its 8 years.
    expect(computeAssetDepreciation(asset('05/2016', usd(10_000), 7), 2025).deduction).toBe(0);
  });

  it('reads the usual date shapes and refuses the rest', () => {
    expect(readPlacedInService('6/2015')).toEqual({ month: 6, year: 2015 });
    expect(readPlacedInService('06/15/2015')).toEqual({ month: 6, year: 2015 });
    expect(readPlacedInService('2015-06-15')).toEqual({ month: 6, year: 2015 });
    expect(readPlacedInService('sometime in 2015')).toBeNull();
    expect(readPlacedInService('13/2015')).toBeNull();
  });
});

describe('IRA distributions the payer didn’t figure', () => {
  it('counts the whole distribution when box 2a is blank or 2b says not determined, and puts Roth IRAs on line 4', () => {
    const f = facts({
      f1099R: [
        r1099({ iraSepSimple: true, box1GrossDistribution: usd(20_000), box2aTaxableAmount: 0, box2aBlank: true, box7Codes: '7' }),
        r1099({
          iraSepSimple: true,
          box1GrossDistribution: usd(5_000),
          box2aTaxableAmount: 0,
          box2bTaxableNotDetermined: true,
          box7Codes: '7',
        }),
        r1099({ iraSepSimple: true, box1GrossDistribution: usd(8_000), box2aTaxableAmount: 0, box7Codes: 'G' }),
        r1099({ iraSepSimple: false, box1GrossDistribution: usd(3_000), box2aTaxableAmount: 0, box7Codes: 'Q' }),
      ],
    });
    const r = computeFederal(f);
    expect(r.ledger.get('f1040.4a')).toBe(usd(36_000));
    expect(r.ledger.get('f1040.4b')).toBe(usd(25_000));
    expect(r.ledger.get('f1040.5a')).toBe(0);
  });
});

describe('Form 8582 line 6 counts the nonpassive parts of Schedule E', () => {
  const rental: RentalProperty = {
    id: 'rent-1',
    owner: 'taxpayer',
    address: '1 Main St, Rockville, MD',
    propertyType: 1,
    fairRentalDays: 365,
    personalUseDays: 0,
    activeParticipation: true,
    rentsReceived: usd(10_000),
    expenses: { mortgageInterest: usd(15_000), taxes: usd(5_000) },
  };
  const business: ScheduleK1 = {
    id: 'k1-1',
    owner: 'taxpayer',
    entityType: '1065',
    entityName: 'Rivera Consulting LLC',
    entityEin: '52-1234567',
    isMaterialParticipation: true,
    ordinaryBusinessIncome: usd(40_000),
    netRentalRealEstateIncome: 0,
    interestIncome: 0,
    ordinaryDividends: 0,
    qualifiedDividends: 0,
    netShortTermCapitalGain: 0,
    netLongTermCapitalGain: 0,
    netSection1231Gain: 0,
  };

  it('so income from a business you work in shrinks the $25,000 rental allowance', () => {
    const r = computeFederal(facts({ w2s: [w2({ box1Wages: usd(80_000) })], rentals: [rental], k1s: [business] }));
    // Wages $80,000 + nonpassive K-1 $40,000 = $120,000 MAGI: allowance 50% × ($150,000 − $120,000) = $15,000,
    // more than the $10,000 loss, so all of it is allowed.
    expect(r.ledger.get('f8582.6')).toBe(usd(120_000));
    expect(r.ledger.get('f8582.8')).toBe(usd(15_000));
    const big = computeFederal(
      facts({ w2s: [w2({ box1Wages: usd(80_000) })], rentals: [rental], k1s: [{ ...business, ordinaryBusinessIncome: usd(70_000) }] }),
    );
    expect(big.ledger.get('f8582.6')).toBe(usd(150_000));
    expect(big.ledger.get('f8582.9')).toBe(0);
    expect(big.scheduleE.passiveLossCarryoverTo2026).toBe(usd(10_000));
  });
});

describe('Schedule E rows that don’t fit', () => {
  it('are reported instead of dropped', () => {
    const rentals: RentalProperty[] = [1, 2, 3, 4].map((i) => ({
      id: `rent-${i}`,
      owner: 'taxpayer' as const,
      address: `${i} Main St`,
      propertyType: 1 as const,
      fairRentalDays: 365,
      personalUseDays: 0,
      rentsReceived: usd(1_000),
      expenses: {},
    }));
    expect(computeFederal(facts({ rentals })).scheduleE.overflow).toEqual(['4 rental or royalty properties (Schedule E has room for 3)']);
  });
});

describe('Maryland', () => {
  it('adds back state retirement pickup and leaves the federal result alone', () => {
    const f = facts({
      residency: { state: 'MD', fullYear: true, mdCounty: 'Montgomery', mdSubdivision: { code: '1600', name: 'Montgomery County' } },
      w2s: [
        w2({
          box1Wages: usd(70_000),
          box14: [{ description: 'STPICKUP', amount: usd(3_500) }],
          stateLines: [{ state: 'MD', stateWages: usd(73_500), stateTax: usd(3_000) }],
          localLines: [{ locality: 'MONTGOMERY', localWages: usd(73_500), localTax: usd(1_000) }],
        }),
        w2({
          box1Wages: usd(10_000),
          stateLines: [
            { state: 'MD', stateWages: usd(5_000), stateTax: usd(200) },
            { state: 'PA', stateWages: usd(5_000), stateTax: usd(150) },
          ],
          localLines: [{ locality: 'PHILADELPHIA', localWages: usd(5_000), localTax: usd(190) }],
        }),
      ],
    });
    const fed = computeFederal(f);
    const before = fed.ledger.all().length;
    const md = computeMd(f, fed);
    expect(md.ledger.get('md502.3')).toBe(usd(3_500));
    expect(md.ledger.get('md502.6')).toBe(usd(3_500));
    // MD withholding: $3,000 + $1,000 county on the Maryland-only W-2, and $200 Maryland on the other; Philadelphia's isn't.
    expect(md.ledger.get('md502.41')).toBe(usd(4_200));
    expect(fed.ledger.all()).toHaveLength(before);
  });
});
