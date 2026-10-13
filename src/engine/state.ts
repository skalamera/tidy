import type { FederalResult } from './federal/form1040';
import { computeMd, type MdResult } from './md/form502';
import type { TaxFacts } from '../shared/facts';

/** Tagged so more states can be added later without changing callers. */
export type StateResult = { state: 'MD'; md: MdResult };

/** The Maryland resident return, or null when residency isn't known (or isn't supported) yet. */
export function computeStateReturn(f: TaxFacts, fed: FederalResult): StateResult | null {
  if (f.residency.fullYear === false) return null;
  if (f.residency.state === 'MD') return { state: 'MD', md: computeMd(f, fed) };
  return null;
}

export const stateTotals = (s: StateResult) => s.md;
