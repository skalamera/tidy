import { addressText, maskSsn, parseAddress, parseName } from '../../shared/answers';
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
};

/** An answer the way the user reads it back. A Social Security number shows only its last 4 digits. */
export function answerText(q: Question): string {
  if (q.answer === null) return '';
  if (q.kind === 'ssn') return maskSsn(q.answer);
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
  return q.choices?.find((c) => c.value === q.answer)?.label ?? q.answer;
}
