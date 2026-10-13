import { describe, expect, it } from 'vitest';
import { buildView } from '../../src/core/view';
import { deriveFacts } from '../../src/core/deriveFacts';
import { reconcileQuestions } from '../../src/core/reconcile';
import { doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

describe('buildView', () => {
  it('guides a brand-new user to the welcome step', () => {
    const v = buildView({ ...stateWith(), onboarding: { welcomed: false, priorYearSkipped: false } }, { aiProvider: null });
    expect(v.now.cta?.intent).toEqual({ type: 'welcome' });
    expect(v.progress).toEqual({ approved: 0, total: 10 });
    expect(v.canExport).toBe(false);
  });

  it('after reading documents, points at profile questions and shows masked SSNs and sourced amounts', () => {
    const s0 = stateWith({ documents: [doc('py', [priorYear()]), doc('d1', [w2Extraction()])] });
    const s = { ...s0, questions: reconcileQuestions(s0) };
    const v = buildView(s, { aiProvider: 'anthropic' });
    expect(v.now.title).toMatch(/^Answer \d+ quick questions$/);
    expect(v.now.detail).toContain('“About you”');
    expect(v.details.profile[0].rows[1].value).toBe('•••-••-0001');
    const wageRow = v.details.wages[0].rows[0];
    expect(wageRow.value).toBe('$85,000');
    expect(wageRow.source?.docId).toBe('d1');
    expect(v.summary.agi).toBe(8_500_000);
  });

  it('raises a blocker for unsupported documents', () => {
    const s = stateWith({ documents: [doc('k1', [], { status: 'unsupported', docType: 'k1_1065' })] });
    const v = buildView(s, { aiProvider: 'gemini' });
    expect(v.flags[0].severity).toBe('blocker');
    expect(v.flags[0].title).toBe('Tidy can’t prepare partnership K-1s yet');
  });

  it('uses only a 2024 return as last year’s, and says why another year’s is set aside', () => {
    const s = stateWith({ documents: [doc('py', [priorYear({ taxYear: 2023 })])] });
    const v = buildView(s, { aiProvider: 'anthropic' });
    expect(v.now.title).toBe('Start with last year’s return');
    expect(v.flags).toContainEqual({
      id: 'wrong-year:py',
      sectionId: 'documents',
      severity: 'warning',
      title: '“py.pdf” is your 2023 return',
      detail: 'Tidy fills in 2025 from your 2024 return, so it doesn’t use this one. Upload your 2024 return, then remove this file.',
    });
    // The 2023 overpayment applied to 2024 must not turn into a 2025 payment.
    expect(deriveFacts(s).payments.federalPriorYearApplied).toBe(0);
  });
});
