import { describe, expect, it } from 'vitest';
import { vinProblem } from '../../src/core/vin';

describe('vehicle identification numbers', () => {
  it('accept a real VIN and catch typos with the check digit', () => {
    expect(vinProblem('1M8GDM9AXKP042788')).toBeNull();
    expect(vinProblem(' 1m8gdm9axkp042788 ')).toBeNull();
    expect(vinProblem('1M8GDM9A1KP042788')).toContain('check digit');
    expect(vinProblem('1M8GDM9AXKP04278')).toContain('17 letters and digits');
    expect(vinProblem('1M8GDM9AXKP0427O8')).toContain('without I, O or Q');
  });
});
