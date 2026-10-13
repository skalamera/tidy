import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { MD_LOCAL_2025 } from '../../src/engine/params/md2025';
import { deriveFacts } from '../../src/core/deriveFacts';
import { deriveFlags } from '../../src/core/flags';
import { buildView } from '../../src/core/view';
import MD_SUBDIVISIONS from '../../src/shared/data/md-subdivisions-2025.json';
import type { AppState } from '../../src/shared/state';
import { usd } from '../../src/engine/money';
import { div1099 } from '../fixtures/facts';
import { answered as answer, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const base = () => stateWith({ documents: [doc('py', [priorYear()]), doc('d1', [w2Extraction()])] });

describe('Maryland questions', () => {
  it('asks Maryland residents where they lived and about estimated payments', () => {
    const s = answer(base(), { 'filing-status-same': 'yes', 'resident-state': 'MD' });
    const ids = s.questions.map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['md-subdivision', 'state-estimates-2025', 'state-estimate-january']));
    const where = s.questions.find((q) => q.id === 'md-subdivision')!;
    expect(where.choices!.find((c) => c.value === '1609')?.label).toBe('City of Rockville · Montgomery County');
    expect(where.choices!.find((c) => c.value === '0300')?.label).toBe('Baltimore County (not in a town)');
  });

  it('writes answers into the facts', () => {
    const s = answer(base(), {
      'filing-status-same': 'yes',
      'resident-state': 'MD',
      'md-subdivision': '1609',
      'federal-estimates': '1000000',
      'state-estimates-2025': '300000',
      'state-estimate-january': '100000',
    });
    const f = deriveFacts(s);
    expect(f.residency).toMatchObject({ state: 'MD', mdCounty: 'Montgomery', mdSubdivision: { code: '1609', name: 'City of Rockville' } });
    expect(f.payments.federalEstimated).toEqual([1_000_000]);
    expect(f.stateReturn.estimatedPayments).toEqual([300_000, 100_000]);
    // Only the payment made during 2025 counts toward the 2025 SALT deduction.
    expect(f.itemized.stateIncomeTaxPayments.map((p) => p.amount)).toEqual([300_000]);
  });

  it('blocks returns it cannot prepare yet instead of guessing', () => {
    const s = answer(base(), {
      'filing-status-same': 'yes',
      'resident-state': 'MD',
      'has-dependents': 'yes',
      'senior-or-blind': 'yes',
      'other-income': 'yes',
    });
    const f = deriveFacts(s);
    const ids = deriveFlags(s, f, computeFederal(f))
      .filter((x) => x.severity === 'blocker')
      .map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['dependents', 'senior-or-blind', 'other-income']));
  });

  it('blocks part-year residents and other states', () => {
    const blockers = (s: AppState) => {
      const f = deriveFacts(s);
      return deriveFlags(s, f, computeFederal(f)).map((x) => x.id);
    };
    expect(blockers(answer(base(), { 'filing-status-same': 'yes', 'resident-state': 'MD', 'full-year-resident': 'no' }))).toContain(
      'part-year',
    );
    expect(blockers(answer(base(), { 'filing-status-same': 'yes', 'resident-state': 'other' }))).toContain('state-other');
  });

  const withPriorCounty = (mdCounty: string) => stateWith({ documents: [doc('py', [priorYear({ mdCounty })])] });

  it('reads last year’s county however the return prints it', () => {
    const county = (raw: string) => deriveFacts(withPriorCounty(raw)).residency.mdCounty;
    expect(county('MONTGOMERY')).toBe('Montgomery');
    expect(county('Montgomery County')).toBe('Montgomery');
    expect(county('Anne Arundel Co.')).toBe('Anne Arundel');
    expect(county('Prince George’s County')).toBe("Prince George's");
    expect(county('Saint Mary’s')).toBe("St. Mary's");
    expect(county('BALTIMORE CITY')).toBe('Baltimore City');
    expect(county('Baltimore County')).toBe('Baltimore County');
    expect(county('Baltimore')).toBeNull(); // the city or the county: ask rather than guess
  });

  it('still builds the return when last year’s county is not one it knows', () => {
    const s = withPriorCounty('Rockville');
    expect(deriveFacts(s).residency.mdCounty).toBeNull();
    expect(() => buildView(s, { aiProvider: 'anthropic' })).not.toThrow();
  });

  it('only offers subdivisions in counties with a local tax rate', () => {
    for (const d of MD_SUBDIVISIONS) expect(Object.keys(MD_LOCAL_2025)).toContain(d.county);
  });
});

describe('deductions Tidy can’t take yet', () => {
  it('warns that Section 199A dividends (1099-DIV box 5) get no QBI deduction yet', () => {
    const s = answer(base(), { 'filing-status-same': 'yes', 'resident-state': 'MD' });
    const f = { ...deriveFacts(s), f1099Div: [div1099({ box1aOrdinaryDividends: usd(10_000), box5Section199aDividends: usd(2_500) })] };
    const flag = deriveFlags(s, f, computeFederal(f)).find((x) => x.id === 'qbi-dividends');
    expect(flag).toMatchObject({
      severity: 'warning',
      sectionId: 'investments',
      title: 'Your 1099-DIV shows $2,500 of Section 199A dividends',
    });
  });
});
