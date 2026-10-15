import { describe, expect, it } from 'vitest';
import { buildView, problemView } from '../../src/core/view';
import { NO_CHAT } from '../../src/shared/chat';
import { deriveFacts } from '../../src/core/deriveFacts';
import { reconcileQuestions } from '../../src/core/reconcile';
import { doc, NOW, priorYear, stateWith, w2Extraction } from '../fixtures/state';

describe('problemView', () => {
  it('keeps documents, questions and chat, pauses every step, and never allows printing', () => {
    const s0 = stateWith({ documents: [doc('d1', [w2Extraction()])] });
    const s = { ...s0, questions: reconcileQuestions(s0), approvals: { profile: { approvedAt: NOW, snapshotHash: 'x' } } };
    const chat = { ...NO_CHAT, currentId: 'c1', messages: [{ id: 'm1', role: 'user' as const, text: 'Hi', at: NOW, proposalIds: [] }] };
    const v = problemView(s, { aiProvider: 'gemini', chat });
    expect(v.problem).toBe(true);
    expect(v.now).toEqual({
      title: 'Tidy hit a snag',
      detail:
        'Something unexpected stopped Tidy from working out your return. Your documents and answers are saved. If you just added a file or changed an answer, try undoing it.',
      cta: { label: 'Open documents', intent: { type: 'open_section', sectionId: 'documents' } },
      tone: 'fix',
    });
    expect(new Set(v.sections.map((x) => x.status))).toEqual(new Set(['paused']));
    expect(v.documents.map((d) => d.id)).toEqual(['d1']);
    expect(v.questions).toBe(s.questions);
    expect(v.chat).toBe(chat);
    expect(v.progress).toEqual({ approved: 1, total: 10 });
    expect(v.canExport).toBe(false);
    expect(buildView(s, { aiProvider: 'gemini' }).problem).toBe(false);
  });
});

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
    const s = stateWith({ documents: [doc('stmt', [], { status: 'unsupported', docType: 'brokerage_statement' })] });
    const v = buildView(s, { aiProvider: 'gemini' });
    expect(v.flags[0].severity).toBe('blocker');
    expect(v.flags[0].title).toBe('Tidy can’t prepare brokerage statements yet');
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
