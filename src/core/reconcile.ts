import { formatUsd } from '../engine/money';
import type { AppState, DocumentRecord, FieldCheck, Question, SectionId } from '../shared/state';
import { amountAt, amountCents } from './amount';
import { deriveFacts, latestPriorYear, unclearOwners } from './deriveFacts';
import { expectedNow, missingExpected, sameIssuer } from './expected';
import { ITEM_RULES } from './itemRules';
import { RULES } from './questionRules';

const FORM_SECTION: Record<string, SectionId> = {
  w2: 'wages',
  f1099_r: 'wages',
  f1099_nec: 'wages',
  ssa_1099: 'wages',
  k1: 'wages',
  f1099_int: 'investments',
  f1099_div: 'investments',
  f1099_b: 'investments',
  f1098: 'deductions',
  payment: 'deductions',
  prior_year: 'profile',
  f1099_misc: 'investments',
  f1099_oid: 'investments',
  f1099_g: 'wages',
  prior_state: 'profile',
};
/** Forms whose amounts can be losses, so a correction may be negative. */
const SIGNED_FORMS = new Set(['k1', 'f1099_b', 'prior_year']);

const FORM_LABEL: Record<string, string> = {
  w2: 'W-2',
  f1099_r: '1099-R',
  f1099_nec: '1099-NEC',
  ssa_1099: 'SSA-1099',
  k1: 'Schedule K-1',
  f1099_int: '1099-INT',
  f1099_div: '1099-DIV',
  f1099_b: '1099-B',
  f1098: 'Form 1098',
  payment: 'payment record',
  prior_year: '2024 return',
  f1099_misc: '1099-MISC',
  f1099_oid: '1099-OID',
  f1099_g: '1099-G',
  prior_state: '2024 state return',
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

/** Most amounts one grouped question asks a person to check; past this the document can't be checked by hand. */
export const GROUP_LIMIT = 60;

/** A row's amount, worded for a person: "Sale 4 (100 sh Example Co): proceeds", "MD: state tax". */
function nestedLabel(data: unknown, path: string): string {
  const [collection, index, ...rest] = path.split('.');
  const row = (data as Record<string, unknown> | null)?.[collection];
  const item = Array.isArray(row) ? (row[Number(index)] as Record<string, unknown> | undefined) : undefined;
  const text = (k: string) => (typeof item?.[k] === 'string' && (item[k] as string).trim() ? (item[k] as string).trim() : null);
  const field = fieldLabel(rest.join('.'));
  const n = Number(index) + 1;
  switch (collection) {
    case 'lots':
      return `Sale ${n}${text('description') ? ` (${text('description')})` : ''}: ${field}`;
    case 'stateLines':
      return `${text('state') ?? `State line ${n}`}: ${field}`;
    case 'localLines':
      return `${text('locality') ?? `Local line ${n}`}: ${field}`;
    case 'box12':
      return `Box 12${text('code') ? ` code ${text('code')}` : ` line ${n}`}`;
    case 'box14':
      return `Box 14${text('description') ? ` ${text('description')}` : ` line ${n}`}`;
    default:
      return item ? `${fieldLabel(collection)} ${n}: ${field}` : fieldLabel(path);
  }
}

/** The amounts a person has to check on a document: unverified (a scan), mismatched with the page, or a box that
 *  every such form fills in that came back blank. Top-level boxes are one question each; rows (sales, state lines,
 *  last year's carryovers) are one question per table. */
function uncheckedAmounts(doc: DocumentRecord) {
  const single: { key: string; path: string; idx: number; check: FieldCheck }[] = [];
  const groups = new Map<string, { idx: number; paths: string[]; checks: Set<FieldCheck> }>();
  if (doc.status !== 'done' || doc.supersededBy) return { single, groups };
  for (const [key, check] of Object.entries(doc.fieldChecks)) {
    if (check === 'verified') continue;
    const [idxText, path] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const x = doc.extractions[Number(idxText)];
    const a = x ? amountAt(x.data, path) : null;
    if (!x || !a || (a.amount === null && check !== 'missing')) continue;
    if (path.includes('.') && amountCents(a) >= 0) {
      const g = `${idxText}:${path.split('.')[0]}`;
      const group = groups.get(g) ?? { idx: Number(idxText), paths: [], checks: new Set<FieldCheck>() };
      group.paths.push(path);
      group.checks.add(check);
      groups.set(g, group);
    } else single.push({ key, path, idx: Number(idxText), check });
  }
  return { single, groups };
}

/** Tables on a document with more amounts to check than a person can do by hand (see flags). */
export function oversizedChecks(doc: DocumentRecord): number {
  return [...uncheckedAmounts(doc).groups.values()].filter((g) => g.paths.length > GROUP_LIMIT).reduce((n, g) => n + g.paths.length, 0);
}

/** Blocking "is this right?" questions for every amount Tidy couldn't check against the page itself. */
export function confirmQuestions(doc: DocumentRecord): Omit<Question, 'answer' | 'answeredAt'>[] {
  const out: Omit<Question, 'answer' | 'answeredAt'>[] = [];
  const issuer = doc.classification?.issuerName ?? doc.fileName;
  const { single, groups } = uncheckedAmounts(doc);
  for (const { key, path, idx, check } of single) {
    const x = doc.extractions[idx];
    const a = amountAt(x.data, path)!;
    const form = FORM_LABEL[x.form] ?? 'form';
    const missing = check === 'missing';
    out.push({
      id: `confirm:${doc.id}:${key}`,
      sectionId: FORM_SECTION[x.form] ?? 'documents',
      kind: 'confirm_amount',
      signed: amountCents(a) < 0 || SIGNED_FORMS.has(x.form),
      prompt: missing
        ? `We didn’t find ${fieldLabel(path)} on the ${issuer} ${form}. Is it blank?`
        : `We read ${formatUsd(amountCents(a), { cents: true })} for ${fieldLabel(path)} on the ${issuer} ${form}. Is that right?`,
      help: missing
        ? 'This box usually has an amount, so we need a human eye. If it does, choose “No, fix it” and enter it.'
        : check === 'mismatch'
          ? 'The number we read doesn’t match the text on that page, so we need a human eye.'
          : 'This page is a scan, so we couldn’t double-check the number automatically.',
      choices: null,
      suggested: missing ? null : amountCents(a),
      blocking: true,
      origin: 'extraction',
    });
  }
  for (const [g, { idx, paths, checks }] of groups) {
    if (paths.length > GROUP_LIMIT) continue;
    const x = doc.extractions[idx];
    out.push({
      id: `confirm-group:${doc.id}:${g}`,
      sectionId: FORM_SECTION[x.form] ?? 'documents',
      kind: 'lines',
      prompt: `Check ${paths.length === 1 ? 'this amount' : `these ${paths.length} amounts`} on the ${issuer} ${FORM_LABEL[x.form] ?? 'form'}`,
      help: checks.has('mismatch')
        ? 'Some numbers we read don’t match the text on the page. Compare each one with your document, fix any that are wrong, then save.'
        : checks.has('missing')
          ? 'Some boxes came back blank. Enter what your document shows, leave a line blank if it’s empty, then save.'
          : 'This page is a scan, so we couldn’t double-check these. Compare each one with your document, fix any that are wrong, then save.',
      choices: paths.map((p) => ({ value: p, label: nestedLabel(x.data, p) })),
      suggested: null,
      suggestedLines: Object.fromEntries(paths.map((p) => [p, amountCents(amountAt(x.data, p)!)]).filter(([, c]) => (c as number) > 0)),
      blocking: true,
      origin: 'extraction',
    });
  }
  return out;
}

/** Recompute the full question list: rule questions (keeping earlier answers), confirm questions,
 *  and missing-document questions. Iterates because answers can switch other rules on/off. */
/** Brings everything that follows from the documents and answers up to date on a draft: the documents to expect,
 *  then the questions (some of which ask about missing expected documents). */
export function reconcile(d: AppState): void {
  const replaced = supersessions(d.documents);
  for (const doc of d.documents) doc.supersededBy = replaced.get(doc.id) ?? null;
  d.expected = expectedNow(d);
  d.questions = reconcileQuestions(d);
}

const words = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
/** Same person, or one of the two names is unknown. Matches on the first name, so "ALEX J RIVERA" is "Alex Rivera". */
const sameRecipient = (a: string | null | undefined, b: string | null | undefined) => {
  const [x, y] = [words(a), words(b)];
  return x.length === 0 || y.length === 0 || x[0] === y[0];
};

/** Which document each corrected form replaces: an earlier form of the same kind from the same issuer for the same
 *  person (the latest correction wins). Worked out from the documents every time, so removing a correction brings
 *  the original back, and one spouse's correction never hides the other's form. */
export function supersessions(docs: readonly DocumentRecord[]): Map<string, string> {
  const out = new Map<string, string>();
  const corrections = docs.filter((c) => c.status === 'done' && c.classification?.isCorrected && c.classification.issuerName);
  for (const o of docs) {
    if (o.status !== 'done' || !o.classification?.issuerName) continue;
    const by = corrections
      .filter(
        (c) =>
          c.id !== o.id &&
          c.docType === o.docType &&
          sameIssuer(c.classification!.issuerName!, o.classification!.issuerName!) &&
          sameRecipient(c.classification!.recipientName, o.classification!.recipientName) &&
          (!o.classification!.isCorrected || c.addedAt > o.addedAt),
      )
      .sort((p, q) => q.addedAt.localeCompare(p.addedAt))[0];
    if (by) out.set(o.id, by.id);
  }
  return out;
}

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
    for (const r of ITEM_RULES) {
      for (const it of r.items(ctx)) {
        const id = `${r.id}:${it.key}`;
        const prev = keep(id);
        next.push({
          ...r.build(ctx, it),
          id,
          sectionId: r.sectionId,
          origin: 'rule',
          answer: prev?.answer ?? null,
          answeredAt: prev?.answeredAt ?? null,
        });
      }
    }
    for (const d of s.documents) {
      for (const q of confirmQuestions(d)) {
        const prev = keep(q.id);
        next.push({ ...q, answer: prev?.answer ?? null, answeredAt: prev?.answeredAt ?? null });
      }
    }
    for (const u of unclearOwners(s, ctx.facts)) {
      const id = `owner:${u.itemId}`;
      const prev = keep(id);
      const issuer = u.doc.classification?.issuerName ?? u.doc.fileName;
      const name = u.name.trim();
      next.push({
        id,
        sectionId: FORM_SECTION[u.x.form] ?? 'documents',
        kind: 'choice',
        prompt: `Whose ${FORM_LABEL[u.x.form] ?? 'form'} from ${issuer} is this?`,
        help: name
          ? `It’s made out to “${name}”, which doesn’t clearly match either of you. Tidy needs to know for Social Security, Medicare and Maryland’s two-income subtraction.`
          : 'It doesn’t show a name Tidy can match to either of you.',
        choices: [
          { value: 'taxpayer', label: `${ctx.facts.taxpayer.firstName.trim()} (you)` },
          { value: 'spouse', label: `${ctx.facts.spouse?.firstName.trim() ?? ''} (your spouse)` },
        ],
        suggested: null,
        blocking: true,
        origin: 'extraction',
        answer: prev?.answer ?? null,
        answeredAt: prev?.answeredAt ?? null,
      });
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
