import { localDay } from '../../core/chatSearch';
import { addressText, dateText, maskSsn, parseAddress, parseLines, parseName } from '../../shared/answers';
import type { Question, SectionStatus } from '../../shared/state';
import { usdExact } from './format';

/** Plain-English status shown in the sidebar and on each step's header. */
export const STATUS_LABEL: Record<SectionStatus, string> = {
  locked: 'Later',
  working: 'Reading…',
  needs_answers: 'Needs answers',
  ready: 'Ready to approve',
  approved: 'Approved',
  needs_reapproval: 'Changed, approve again',
  paused: 'Paused',
};

/** A day (YYYY-MM-DD) the way the chat list heads it: Today, Yesterday, or the date, with the year only when it isn't this one. */
export function dayLabel(day: string, today: Date): string {
  if (day === localDay(today.toISOString())) return 'Today';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day === localDay(yesterday.toISOString())) return 'Yesterday';
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(year === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** A time of day the way people say it, like 2:05 PM. */
export const timeLabel = (iso: string): string => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** An answer the way the user reads it back. A Social Security number shows only its last 4 digits. */
export function answerText(q: Question): string {
  if (q.answer === null) return '';
  if (q.kind === 'ssn') return maskSsn(q.answer);
  if (q.kind === 'date') return dateText(q.answer);
  if (q.kind === 'name') {
    const n = parseName(q.answer);
    return n ? `${n.first} ${n.last}` : '';
  }
  if (q.kind === 'address') {
    const a = parseAddress(q.answer);
    return a ? addressText(a) : '';
  }
  if (q.kind === 'yes_no' || (q.kind === 'confirm_amount' && q.answer === 'yes')) return q.answer === 'yes' ? 'Yes' : 'No';
  if (q.kind === 'money' || q.kind === 'confirm_amount') return usdExact(Number.parseInt(q.answer, 10));
  if (q.kind === 'lines') {
    const v = parseLines(q.answer);
    return v ? `${usdExact(Object.values(v).reduce((a, b) => a + b, 0))} total` : '';
  }
  if (q.kind === 'counts' || q.kind === 'area') {
    const v = parseLines(q.answer, null, q.kind);
    return v ? (q.choices ?? []).map((c) => `${c.label}: ${v[c.value] ?? 0}`).join(', ') : '';
  }
  return q.choices?.find((c) => c.value === q.answer)?.label ?? q.answer;
}
