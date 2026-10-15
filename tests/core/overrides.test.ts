import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOverrides, changeText, editableFacts, overrideProblem } from '../../src/core/overrides';
import { deriveFacts } from '../../src/core/deriveFacts';
import { buildView } from '../../src/core/view';
import { computeFederal } from '../../src/engine/federal/form1040';
import type { Override } from '../../src/shared/state';
import { doc, NOW, stateWith, w2Extraction } from '../fixtures/state';

// computeFederal runs for real unless a test makes it throw on one value, the way an engine bug would.
vi.mock('../../src/engine/federal/form1040', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/federal/form1040')>();
  return { ...real, computeFederal: vi.fn(real.computeFederal) };
});
const { computeFederal: realComputeFederal } =
  await vi.importActual<typeof import('../../src/engine/federal/form1040')>('../../src/engine/federal/form1040');
afterEach(() => void vi.mocked(computeFederal).mockImplementation(realComputeFederal));

const WAGES = ['w2s', 'w2-d1-0', 'box1Wages'];
const o = (path: unknown[], value: unknown, p: Partial<Override> = {}): Override => ({
  id: `o-${JSON.stringify(path)}`,
  path: path as string[],
  value,
  reason: 'test',
  createdAt: NOW,
  createdBy: 'ai_proposal',
  ...p,
});
const withW2 = (overrides: Override[] = []) => stateWith({ documents: [doc('d1', [w2Extraction()])], overrides });

describe('overrides are checked like untrusted input', () => {
  const facts = deriveFacts(withW2());

  it('never reaches JavaScript internals', () => {
    for (const path of [
      ['__proto__', 'polluted'],
      ['constructor', 'prototype', 'polluted'],
      ['w2s', '__proto__', 'polluted'],
      ['taxpayer', '__proto__', 'hasOwnProperty'],
    ]) {
      expect(overrideProblem(facts, path, 1)).not.toBeNull();
      const { skipped } = applyOverrides(facts, [o(path, 1)]);
      expect(skipped).toHaveLength(1);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(typeof Object.prototype.hasOwnProperty).toBe('function');
  });

  it('takes only a value of the fact’s own type', () => {
    expect(overrideProblem(facts, WAGES, 8_600_000)).toBeNull();
    expect(overrideProblem(facts, WAGES, '086000')).toMatch(/must be a number/);
    expect(overrideProblem(facts, WAGES, 86_000.5)).toMatch(/whole number/);
    expect(overrideProblem(facts, WAGES, Number.NaN)).toMatch(/must be a number/);
    expect(overrideProblem(facts, WAGES, 1e20)).toMatch(/must be a number/);
    const muni = ['stateReturn', 'homeStateMuniInterest'];
    expect(overrideProblem(facts, muni, 120_000)).toBeNull(); // an empty amount can be filled in
    expect(overrideProblem(facts, muni, '1200')).toMatch(/must be a number/);
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'retirementPlan'], false)).toBeNull();
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'retirementPlan'], 'no')).toMatch(/true or false/);
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'owner'], 'spouse')).toBeNull();
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'owner'], 'bob')).toMatch(/taxpayer, spouse/);
  });

  it('refuses facts that come from answers or identity documents, ids, and whole items', () => {
    expect(overrideProblem(facts, ['filingStatus'], 'mfj')).toMatch(/can’t be changed from chat/);
    expect(overrideProblem(facts, ['digitalAssets'], false)).toMatch(/can’t be changed from chat/);
    expect(overrideProblem(facts, ['taxYear'], 2026)).toMatch(/can’t be changed from chat/);
    expect(overrideProblem(facts, ['taxpayer', 'ssn'], '123456789')).toMatch(/can’t be changed from chat/);
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'evidence', 'box1Wages', 'verified'], true)).toMatch(/can’t be changed/);
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'employerName'], 'Evil Corp')).toMatch(/can’t be changed/);
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0', 'id'], 'x')).not.toBeNull();
    expect(overrideProblem(facts, ['w2s', 'w2-d1-0'], 5)).not.toBeNull();
    expect(overrideProblem(facts, [], 5)).not.toBeNull();
    expect(overrideProblem(facts, 'w2s', 5)).not.toBeNull();
    expect(overrideProblem(facts, ['w2s', 'w2-gone-0', 'box1Wages'], 5)).toMatch(/find_facts/);
  });

  it('skips a stale override instead of throwing, and applies the rest in order', () => {
    const { facts: out, skipped } = applyOverrides(facts, [
      o(['w2s', 'w2-gone-0', 'box1Wages'], 1),
      o(WAGES, 8_600_000),
      o(['w2s', 'w2-d1-0', 'box1Wages'], 8_700_000, { id: 'later' }),
    ]);
    expect(skipped.map((x) => x.path[1])).toEqual(['w2-gone-0']);
    expect(out.w2s[0].box1Wages).toBe(8_700_000);
    expect(facts.w2s[0].box1Wages).toBe(8_500_000); // the input is never changed
  });

  it('words the change from the facts, and lists what chat can change', () => {
    expect(changeText(facts, WAGES, 8_600_000)).toEqual({
      label: 'W-2 from Acme Corp: Box 1 wages',
      before: '$85,000',
      after: '$86,000',
    });
    expect(changeText(facts, ['stateReturn', 'homeStateMuniInterest'], 120_050)).toEqual({
      label: 'State return: Home state municipal interest',
      before: 'Blank',
      after: '$1,200.50',
    });
    const found = editableFacts(facts);
    expect(found).toContainEqual({ path: WAGES, label: 'W-2 from Acme Corp: Box 1 wages', value: 8_500_000 });
    expect(found.filter((x) => x.value !== null).every((x) => overrideProblem(facts, x.path, x.value) === null)).toBe(true);
    expect(found.some((x) => ['employerName', 'ssn', 'evidence', 'taxYear', 'filingStatus'].some((k) => x.path.includes(k)))).toBe(false);
  });
});

describe('overrides in the view', () => {
  it('sets aside a stale change with a blocker on its step and keeps the return working', () => {
    const s = withW2([
      o(['w2s', 'w2-gone-0', 'box1Wages'], 1, {
        id: 'stale',
        sectionId: 'wages',
        change: { label: 'W-2 from Old Corp: Box 1 wages', before: '$1.00', after: '$2.00' },
      }),
      o(WAGES, 8_600_000, { id: 'good', sectionId: 'wages' }),
    ]);
    const v = buildView(s, { aiProvider: null });
    expect(v.problem).toBe(false);
    expect(v.overrides.map((x) => [x.id, x.applied])).toEqual([
      ['stale', false],
      ['good', true],
    ]);
    // an override saved without its words is worded from the facts before any change
    expect(v.overrides[1].change).toEqual({ label: 'W-2 from Acme Corp: Box 1 wages', before: '$85,000', after: '$86,000' });
    expect(v.flags).toContainEqual(expect.objectContaining({ id: 'override-set-aside:stale', sectionId: 'wages', severity: 'blocker' }));
    expect(v.canExport).toBe(false);
  });

  it('works the return out without the changes when one makes the math fail, instead of pausing every step', () => {
    vi.mocked(computeFederal).mockImplementation((f) => {
      if (f.w2s[0]?.box1Wages === 4_242) throw new RangeError('engine bug');
      return realComputeFederal(f);
    });
    const v = buildView(withW2([o(WAGES, 4_242, { id: 'bad', sectionId: 'wages' })]), { aiProvider: null });
    expect(v.problem).toBe(false);
    expect(v.overrides).toMatchObject([{ id: 'bad', applied: false }]);
    expect(v.flags.map((f) => f.id)).toContain('override-set-aside:bad');
    expect(v.summary.agi).toBeGreaterThan(0);
  });
});
