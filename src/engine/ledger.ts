import { roundToDollar, type Cents } from './money';

/** Line ids look like "f1040.11a", "schA.5e", "qdcg.22", "f8959.7". */
export type LineId = string;

export interface Line {
  id: LineId;
  /** Always whole dollars, stored as cents (a multiple of 100). */
  amount: Cents;
  /** Plain-English label for the UI, e.g. "Adjusted gross income". */
  label: string;
  /** Human-readable formula, e.g. "Line 9 − line 10". */
  formula?: string;
}

/** Records every computed line. Each line is rounded to whole dollars when it is set,
 *  and later lines are computed from the rounded values (IRS "round every line" convention). */
export class Ledger {
  private readonly lines = new Map<LineId, Line>();

  set(id: LineId, amount: Cents, label: string, formula?: string): Cents {
    if (!Number.isInteger(amount)) throw new Error(`Ledger.set(${id}): amount must be integer cents, got ${amount}`);
    const rounded = roundToDollar(amount);
    this.lines.set(id, { id, amount: rounded, label, ...(formula ? { formula } : {}) });
    return rounded;
  }

  get(id: LineId): Cents {
    return this.lines.get(id)?.amount ?? 0;
  }

  has(id: LineId): boolean {
    return this.lines.has(id);
  }

  line(id: LineId): Line | undefined {
    return this.lines.get(id);
  }

  all(): Line[] {
    return [...this.lines.values()];
  }

  /** { "f1040.11a": 44700000, ... } — handy for snapshots and tests. */
  toRecord(prefix?: string): Record<LineId, Cents> {
    const out: Record<LineId, Cents> = {};
    for (const l of this.lines.values()) if (!prefix || l.id.startsWith(prefix)) out[l.id] = l.amount;
    return out;
  }
}
