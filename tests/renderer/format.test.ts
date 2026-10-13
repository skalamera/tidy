import { describe, expect, it } from 'vitest';
import { parseDollars, usd, usdExact } from '../../src/renderer/src/format';
import { dayLabel } from '../../src/renderer/src/labels';

describe('money formatting', () => {
  it('formats cents as dollars', () => {
    expect(usd(1_234_550)).toBe('$12,346');
    expect(usdExact(1_234_550)).toBe('$12,345.50');
    expect(usd(0)).toBe('$0');
  });

  it.each([
    ['12500', 1_250_000],
    ['$12,500.50', 1_250_050],
    [' 1,000.5 ', 100_050],
    ['0', 0],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseDollars(input)).toBe(cents);
  });

  it.each(['', 'abc', '-5', '12.345', '1e5', '$'])('rejects %j', (input) => {
    expect(parseDollars(input)).toBeNull();
  });
});

describe('day labels', () => {
  const today = new Date('2026-10-13T16:00:00.000Z'); // a Tuesday
  it.each([
    ['2026-10-13', 'Today'],
    ['2026-10-12', 'Yesterday'],
    ['2026-09-28', 'Monday, September 28'],
    ['2025-12-31', 'Wednesday, December 31, 2025'],
  ])('names %s', (day, label) => {
    expect(dayLabel(day, today)).toBe(label);
  });
});
