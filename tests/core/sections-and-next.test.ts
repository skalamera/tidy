import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { deriveFacts } from '../../src/core/deriveFacts';
import { sectionStates } from '../../src/core/sections';
import { nextAction, type NextActionInput } from '../../src/core/nextAction';
import { doc, stateWith, w2Extraction, NOW } from '../fixtures/state';
import type { AppState } from '../../src/shared/state';

const statuses = (s: AppState) => {
  const f = deriveFacts(s);
  return sectionStates(s, f, computeFederal(f));
};

describe('sectionStates', () => {
  it('opens only the first section; the rest are locked', () => {
    const st = statuses(stateWith());
    expect(st.map((x) => x.status).slice(0, 3)).toEqual(['ready', 'locked', 'locked']);
  });

  it('marks approved sections stale when their data changes', () => {
    const s = stateWith({ documents: [doc('d1', [w2Extraction()])] });
    const first = statuses(s);
    const approvals = Object.fromEntries(first.slice(0, 3).map((x) => [x.id, { approvedAt: NOW, snapshotHash: x.hash }]));
    const approved = statuses({ ...s, approvals });
    expect(approved.map((x) => x.status).slice(0, 4)).toEqual(['approved', 'approved', 'approved', 'ready']);
    const changed = statuses({
      ...s,
      approvals,
      documents: [doc('d1', [w2Extraction()]), doc('d2', [w2Extraction({ employerName: 'Beta' })])],
    });
    expect(changed.find((x) => x.id === 'documents')?.status).toBe('needs_reapproval');
    expect(changed.find((x) => x.id === 'wages')?.status).toBe('needs_reapproval');
  });

  it('shows working while documents are being read', () => {
    const st = statuses(stateWith({ documents: [doc('d1', [], { status: 'reading' })] }));
    expect(st[0].status).toBe('working');
  });
});

describe('nextAction', () => {
  const base: NextActionInput = {
    welcomed: true,
    hasApiKey: true,
    hasPriorYear: true,
    priorYearSkipped: false,
    busyDocs: 0,
    sections: [],
    missingDocs: 0,
  };
  const sec = (status: NextActionInput['sections'][number]['status'], openQuestions = 0) => [
    { id: 'wages' as const, title: 'Wages', icon: 'x', blurb: '', status, openQuestions, hash: 'h' },
  ];

  it('walks onboarding in order', () => {
    expect(nextAction({ ...base, welcomed: false }).cta?.intent).toEqual({ type: 'welcome' });
    expect(nextAction({ ...base, hasApiKey: false }).cta?.intent).toEqual({ type: 'open_settings' });
    expect(nextAction({ ...base, hasPriorYear: false }).cta?.intent).toEqual({ type: 'upload' });
    expect(nextAction({ ...base, hasPriorYear: false }).secondary).toEqual({
      label: 'I don’t have it',
      intent: { type: 'skip_prior_year' },
    });
    expect(nextAction({ ...base, hasPriorYear: false, priorYearSkipped: true, sections: sec('ready') }).title).toBe(
      'Review and approve: Wages',
    );
  });

  it('points at the first unfinished section', () => {
    expect(nextAction({ ...base, sections: sec('needs_answers', 2) }).title).toBe('Answer 2 quick questions');
    expect(nextAction({ ...base, sections: sec('needs_answers', 1) }).title).toBe('Answer 1 quick question');
    expect(nextAction({ ...base, sections: sec('needs_reapproval') }).cta?.label).toBe('Review changes');
    expect(nextAction({ ...base, busyDocs: 3, sections: sec('working') }).title).toBe('Reading 3 documents…');
    expect(nextAction({ ...base, sections: sec('approved') }).tone).toBe('done');
  });

  it('talks about missing documents in the documents section', () => {
    const s = [
      {
        id: 'documents' as const,
        title: 'Your documents',
        icon: 'x',
        blurb: '',
        status: 'needs_answers' as const,
        openQuestions: 2,
        hash: 'h',
      },
    ];
    expect(nextAction({ ...base, sections: s, missingDocs: 2 }).title).toBe('2 documents still missing');
  });
});
