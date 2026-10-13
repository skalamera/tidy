import { formatUsd } from '../engine/money';
import type { AppState, DocumentRecord, Question, SectionId } from '../shared/state';
import { amountAt, amountCents } from './amount';
import { deriveFacts, latestPriorYear } from './deriveFacts';
import { missingExpected } from './expected';
import { RULES } from './questionRules';

const FORM_SECTION: Record<string, SectionId> = {
  w2: 'wages',
  f1099_int: 'investments',
  f1099_div: 'investments',
  f1098: 'deductions',
  payment: 'deductions',
  prior_year: 'profile',
};
const FORM_LABEL: Record<string, string> = {
  w2: 'W-2',
  f1099_int: '1099-INT',
  f1099_div: '1099-DIV',
  f1098: 'Form 1098',
  payment: 'payment record',
  prior_year: '2024 return',
};

/** "box1Wages" → "box 1 (wages)" for prompts. */
export function fieldLabel(path: string): string {
  const m = /^box(\d+[a-z]?)(.*)$/.exec(path);
  if (!m) return path.replace(/([A-Z])/g, ' $1').toLowerCase();
  const rest = m[2]
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
  return `box ${m[1]}${rest ? ` (${rest})` : ''}`;
}

/** One blocking "is this right?" question per amount we could not verify on the page. */
export function confirmQuestions(doc: DocumentRecord): Omit<Question, 'answer' | 'answeredAt'>[] {
  if (doc.status !== 'done' || doc.supersededBy) return [];
  const out: Omit<Question, 'answer' | 'answeredAt'>[] = [];
  for (const [key, check] of Object.entries(doc.fieldChecks)) {
    if (check === 'verified') continue;
    const [idxText, path] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (path.includes('.')) continue; // nested rows are reviewed in the section, not asked one by one
    const x = doc.extractions[Number(idxText)];
    const a = x ? amountAt(x.data, path) : null;
    if (!x || !a || a.amount === null) continue;
    const issuer = doc.classification?.issuerName ?? doc.fileName;
    out.push({
      id: `confirm:${doc.id}:${key}`,
      sectionId: FORM_SECTION[x.form] ?? 'documents',
      kind: 'confirm_amount',
      prompt: `We read ${formatUsd(amountCents(a), { cents: true })} for ${fieldLabel(path)} on the ${issuer} ${FORM_LABEL[x.form] ?? 'form'}. Is that right?`,
      help:
        check === 'mismatch'
          ? 'The number we read doesn’t match the text on that page, so we need a human eye.'
          : 'This page is a scan, so we couldn’t double-check the number automatically.',
      choices: null,
      suggested: amountCents(a),
      blocking: true,
      origin: 'extraction',
    });
  }
  return out;
}

/** Recompute the full question list: rule questions (keeping earlier answers), confirm questions,
 *  and missing-document questions. Iterates because answers can switch other rules on/off. */
export function reconcileQuestions(state: AppState): Question[] {
  let questions = state.questions;
  for (let pass = 0; pass < 6; pass++) {
    const s: AppState = { ...state, questions };
    const ctx = { state: s, facts: deriveFacts(s), prior: latestPriorYear(s) };
    const keep = (id: string) => questions.find((q) => q.id === id);
    const next: Question[] = [];
    for (const r of RULES) {
      if (!r.applies(ctx)) continue;
      const prev = keep(r.id);
      next.push({
        ...r.build(ctx),
        id: r.id,
        sectionId: r.sectionId,
        origin: 'rule',
        answer: prev?.answer ?? null,
        answeredAt: prev?.answeredAt ?? null,
      });
    }
    for (const d of s.documents) {
      for (const q of confirmQuestions(d)) {
        const prev = keep(q.id);
        next.push({ ...q, answer: prev?.answer ?? null, answeredAt: prev?.answeredAt ?? null });
      }
    }
    for (const m of missingExpected(s)) {
      next.push({
        id: `expected:${m.key}`,
        sectionId: 'documents',
        kind: 'choice',
        prompt: `We haven’t seen your ${FORM_LABEL[m.form] ?? m.form.toUpperCase()} from ${m.name} yet.`,
        help: 'You had one last year. Upload it, or tell us you won’t get one for 2025.',
        choices: [{ value: 'not_this_year', label: 'I won’t get one this year' }],
        suggested: null,
        blocking: true,
        origin: 'rule',
        answer: null,
        answeredAt: null,
      });
    }
    const same = next.length === questions.length && next.every((q, i) => q.id === questions[i]?.id && q.answer === questions[i]?.answer);
    questions = next;
    if (same) break;
  }
  return questions;
}
