import { describe, expect, it } from 'vitest';
import { usd } from '../../src/engine/money';
import { Ledger } from '../../src/engine/ledger';
import { FED_2025 } from '../../src/engine/params/fed2025';
import { FED_2026 } from '../../src/engine/params/fed2026';
import { apportion, computeForm8995, type QbiBusiness } from '../../src/engine/federal/form8995';
import { facts } from '../fixtures/facts';

const mfj = (p = {}) =>
  facts({ filingStatus: 'mfj', spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: null }, ...p });
const biz = (p: Partial<QbiBusiness>): QbiBusiness => ({
  name: 'Biz',
  tin: '123456789',
  isSstb: false,
  qbi: 0,
  w2Wages: 0,
  ubia: 0,
  active: true,
  ...p,
});
const run = (f = mfj(), ti: number, businesses: QbiBusiness[], p = FED_2025) => {
  const l = new Ledger();
  const r = computeForm8995(f, { taxableIncomeBeforeQbi: ti, netCapitalGainAndQualifiedDividends: 0, businesses }, p, l);
  return { r, l };
};

describe('Form 8995-A phase-in range (never fractional cents)', () => {
  // TI $433,333 MFJ: $38,733 over the $394,600 threshold of a $100,000 range -> 38.733% phased in, 61.267% applicable.
  const ti = usd(433_333);

  it('applies Schedule A to an SSTB, then the Part III reduction', () => {
    const { r, l } = run(mfj(), ti, [biz({ name: 'Advisory', isSstb: true, qbi: usd(123_456) })]);
    expect(r.form).toBe('f8995a');
    expect(r.needsScheduleA).toBe(true);
    expect(l.get('f8995aSchA.11.A')).toBe(usd(75_638)); // 123,456 × 61.267%
    expect(r.printed.scheduleALine10).toBe('61.27');
    expect(l.get('f8995a.3.A')).toBe(usd(15_128));
    expect(l.get('f8995a.25.A')).toBe(usd(5_860)); // 15,128 × 38.733%
    expect(l.get('f8995a.26.A')).toBe(usd(9_268));
    expect(r.deduction).toBe(usd(9_268));
    expect(r.printed.phaseInPct).toBe('38.73');
  });

  it('phases in the wage limit for a non-SSTB', () => {
    expect(run(mfj(), ti, [biz({ qbi: usd(123_456) })]).r.deduction).toBe(usd(15_127));
    const { r, l } = run(mfj(), ti, [biz({ qbi: usd(123_456), w2Wages: usd(10_000) })]);
    expect(l.get('f8995a.11.A')).toBe(usd(5_000));
    expect(l.get('f8995a.26.A')).toBe(usd(17_064));
    expect(r.deduction).toBe(usd(17_064));
  });

  it('excludes an SSTB entirely above the phase-in range', () => {
    const { r } = run(mfj(), usd(600_000), [biz({ isSstb: true, qbi: usd(200_000), w2Wages: usd(90_000) })]);
    expect(r.form).toBe('f8995a');
    expect(r.columns).toEqual([]);
    expect(r.deduction).toBe(0);
  });
});

describe('Schedule C (Form 8995-A) loss netting and carryforward', () => {
  it('nets a loss business and last year’s carryforward against income in proportion', () => {
    const f = mfj({ carryovers: { capitalLossShortTerm: 0, capitalLossLongTerm: 0, qbiLoss: usd(10_000), reitPtpLoss: 0 } });
    const { r, l } = run(f, usd(600_000), [
      biz({ name: 'Shop', qbi: usd(100_000), w2Wages: usd(40_000) }),
      biz({ name: 'Rental LP', qbi: usd(-20_000), w2Wages: usd(5_000), ubia: usd(500_000) }),
    ]);
    expect(r.needsScheduleC).toBe(true);
    expect(l.get('f8995aSchC.3')).toBe(usd(30_000));
    expect(l.get('f8995aSchC.4')).toBe(usd(100_000));
    expect(l.get('f8995aSchC.5')).toBe(usd(30_000));
    expect(l.get('f8995aSchC.1c.0')).toBe(usd(70_000));
    expect(l.get('f8995aSchC.1c.1')).toBe(0);
    // The loss business keeps no wages or UBIA (instructions for lines 4 and 7).
    expect(l.get('f8995a.4.B')).toBe(0);
    expect(l.get('f8995a.7.B')).toBe(0);
    expect(l.get('f8995a.11.A')).toBe(usd(14_000));
    expect(r.deduction).toBe(usd(14_000));
    expect(r.carryforwardTo2026.qbiLoss).toBe(0);
  });

  it('carries forward what income can’t absorb', () => {
    const f = mfj({ carryovers: { capitalLossShortTerm: 0, capitalLossLongTerm: 0, qbiLoss: usd(8_000), reitPtpLoss: 0 } });
    const { r, l } = run(f, usd(500_000), [biz({ qbi: usd(5_000), w2Wages: usd(10_000) })]);
    expect(l.get('f8995aSchC.6')).toBe(usd(3_000));
    expect(r.carryforwardTo2026.qbiLoss).toBe(usd(3_000));
    expect(r.deduction).toBe(0);
  });

  it('keeps a carryforward alive with no businesses this year', () => {
    const f = mfj({ carryovers: { capitalLossShortTerm: 0, capitalLossLongTerm: 0, qbiLoss: usd(8_000), reitPtpLoss: 0 } });
    expect(run(f, usd(500_000), []).r.carryforwardTo2026.qbiLoss).toBe(usd(8_000));
    expect(run(f, usd(100_000), []).r.carryforwardTo2026.qbiLoss).toBe(usd(8_000));
  });

  it('apportions to the dollar with no drift', () => {
    const shares = apportion(usd(10_000), [usd(1), usd(1), usd(1)]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(usd(10_000));
    expect(apportion(usd(500), [0, 0])).toEqual([0, 0]);
  });
});

describe('Form 8995 rows and limits', () => {
  it('lists each business on line 1 and flags more than five', () => {
    const six = Array.from({ length: 6 }, (_, k) => biz({ name: `B${k}`, qbi: usd(1_000) }));
    const { r, l } = run(mfj(), usd(100_000), six);
    expect(r.form).toBe('f8995');
    expect(l.get('f8995.1c.4')).toBe(usd(1_000));
    expect(l.has('f8995.1c.5')).toBe(false);
    expect(r.tooManyBusinesses).toBe(true);
  });

  it('flags more than three businesses on Form 8995-A', () => {
    const four = Array.from({ length: 4 }, (_, k) => biz({ name: `B${k}`, qbi: usd(1_000), w2Wages: usd(1_000) }));
    expect(run(mfj(), usd(700_000), four).r.tooManyBusinesses).toBe(true);
  });

  it('gives at least $400 in 2026 when active QBI is $1,000 or more (OBBBA §70105)', () => {
    const f = mfj({ taxYear: 2026 });
    expect(run(f, usd(50_000), [biz({ qbi: usd(1_500) })], FED_2026).r.deduction).toBe(usd(400));
    expect(run(f, usd(50_000), [biz({ qbi: usd(1_500), active: false })], FED_2026).r.deduction).toBe(usd(300));
    expect(run(mfj(), usd(50_000), [biz({ qbi: usd(1_500) })]).r.deduction).toBe(usd(300));
  });
});
