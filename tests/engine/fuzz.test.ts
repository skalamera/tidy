import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeStateReturn } from '../../src/engine/state';
import { household } from '../fixtures/household';

describe('engine never throws (seeded fuzz)', () => {
  it('computes 600 random households without an exception', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      try {
        const f = household(seed);
        const r = computeFederal(f);
        computeStateReturn(f, r);
        for (const line of r.ledger.all())
          if (!Number.isInteger(line.amount) || line.amount % 100 !== 0) failures.push(`${seed}: ${line.id}`);
      } catch (e) {
        failures.push(`${seed}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
