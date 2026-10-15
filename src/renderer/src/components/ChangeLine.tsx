import { ArrowRight } from 'lucide-react';
import type { ChangeText } from '../../../shared/state';

/** "W-2 from Acme Corp: Box 1 wages  $85,000.00 → $86,000.00", worded by Tidy from the return. */
export function ChangeLine({ change }: { change: ChangeText }) {
  return (
    <div className="change-line">
      <strong>{change.label}</strong>
      {(change.before || change.after) && (
        <span className="change-values">
          <span className="change-before">{change.before}</span>
          <ArrowRight size={14} aria-label="changes to" />
          <span className="change-after">{change.after}</span>
        </span>
      )}
    </div>
  );
}
