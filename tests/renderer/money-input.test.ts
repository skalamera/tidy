import { describe, expect, it } from 'vitest';
import { addResultText, parseDollars } from '../../src/renderer/src/format';

describe('typing amounts', () => {
  it('reads a loss only where a loss is allowed', () => {
    expect(parseDollars('$12,500.50')).toBe(1_250_050);
    expect(parseDollars('-1,250')).toBeNull();
    expect(parseDollars('-1,250', { allowNegative: true })).toBe(-125_000);
    expect(parseDollars('($1,250.00)', { allowNegative: true })).toBe(-125_000);
    expect(parseDollars('\u2212$40.5', { allowNegative: true })).toBe(-4_050);
    expect(parseDollars('-0', { allowNegative: true })).toBe(0);
    expect(parseDollars('--5', { allowNegative: true })).toBeNull();
  });
});

describe('the toast after adding files', () => {
  it('says what was added and why anything wasn’t', () => {
    expect(addResultText({ added: 0, duplicates: 0, rejected: [] })).toBeNull();
    expect(addResultText({ added: 2, duplicates: 1, rejected: [] })).toBe('Added 2 documents. One file was already added.');
    expect(addResultText({ added: 0, duplicates: 0, rejected: ['notes.docx isn’t a tax document.', 'b', 'c'] })).toBe(
      'notes.docx isn’t a tax document. 2 more couldn’t be added.',
    );
  });
});
