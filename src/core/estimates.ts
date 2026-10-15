import type { PaymentExtractionT } from '../shared/schemas/extraction';
import type { AppState } from '../shared/state';
import { amountCents } from './amount';
import { stateCode } from './states';

/** When a 2025 estimated payment was made. Each window ends on an installment's due date (June 15, 2025 was a
 *  Sunday, so the second one was due June 16); a payment counts toward the installment its window ends with. */
export const FEDERAL_WINDOWS = [
  { value: 'q1', label: 'Paid by April 15, 2025' },
  { value: 'q2', label: 'Paid April 16 to June 16, 2025' },
  { value: 'q3', label: 'Paid June 17 to September 15, 2025' },
  { value: 'q4', label: 'Paid September 16, 2025 to January 15, 2026' },
  { value: 'late', label: 'Paid after January 15, 2026' },
];

/** The state's windows split the last one at New Year: what was paid in 2025 is also a 2025 state tax deduction. */
export const STATE_WINDOWS = [
  ...FEDERAL_WINDOWS.slice(0, 3),
  { value: 'q4a', label: 'Paid September 16 to December 31, 2025' },
  { value: 'q4b', label: 'Paid January 1 to January 15, 2026' },
  FEDERAL_WINDOWS[4],
];

export function windowOf(datePaid: string, splitAtNewYear: boolean): string {
  if (datePaid <= '2025-04-15') return 'q1';
  if (datePaid <= '2025-06-16') return 'q2';
  if (datePaid <= '2025-09-15') return 'q3';
  if (datePaid <= '2026-01-15') return splitAtNewYear ? (datePaid <= '2025-12-31' ? 'q4a' : 'q4b') : 'q4';
  return 'late';
}

/** The tax year an estimated payment is for: as printed, or else January payments are last year's fourth one. */
const taxYearOf = (d: PaymentExtractionT): number => d.forTaxYear ?? (d.datePaid?.startsWith('2025-01') ? 2024 : 2025);

function payments(state: AppState, kind: 'federal_estimate' | 'state_estimate', residentState: string | null): PaymentExtractionT[] {
  const out: PaymentExtractionT[] = [];
  for (const doc of state.documents) {
    if (doc.status !== 'done' || doc.supersededBy) continue;
    for (const x of doc.extractions) {
      if (x.form !== 'payment' || x.data.kind !== kind) continue;
      const st = stateCode(x.data.state);
      if (kind === 'state_estimate' && st !== '' && st !== residentState) continue;
      out.push(x.data);
    }
  }
  return out;
}

/** What the uploaded payment records say about 2025 payments, by window: a suggestion the user checks. */
export function suggestedWindows(
  state: AppState,
  kind: 'federal_estimate' | 'state_estimate',
  residentState: string | null = null,
): { lines: Record<string, number>; records: number; undated: number } {
  const lines: Record<string, number> = {};
  let records = 0;
  let undated = 0;
  for (const p of payments(state, kind, residentState)) {
    if (taxYearOf(p) !== 2025) continue;
    records++;
    if (!p.datePaid) {
      undated++;
      continue;
    }
    const w = windowOf(p.datePaid, kind === 'state_estimate');
    lines[w] = (lines[w] ?? 0) + amountCents(p.amount);
  }
  return { lines, records, undated };
}

/** 2024 state estimates paid during 2025 (usually the January 2025 one), from the uploaded records. */
export function suggestedPriorYearStatePayments(state: AppState, residentState: string | null): number | null {
  const prior = payments(state, 'state_estimate', residentState).filter((p) => taxYearOf(p) === 2024 && p.datePaid?.startsWith('2025'));
  return prior.length ? prior.reduce((sum, p) => sum + amountCents(p.amount), 0) : null;
}
