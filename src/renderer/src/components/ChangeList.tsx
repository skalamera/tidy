import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { OverrideView } from '../../../core/view';
import { tidy } from '../api';
import { ChangeLine } from './ChangeLine';

/** Changes the user accepted from chat on this step, each with Undo. */
export function ChangeList({ changes, onToast }: { changes: OverrideView[]; onToast: (text: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (changes.length === 0) return null;
  const undo = async (id: string) => {
    setBusy(id);
    const r = await tidy().undoOverride(id);
    setBusy(null);
    if (!r.ok) onToast(r.error);
  };
  return (
    <section className="changes" aria-label="Changes you made">
      <h3>Changes you made</h3>
      <ul>
        {changes.map((c) => (
          <li key={c.id} className={c.applied ? undefined : 'set-aside'}>
            <div>
              <ChangeLine change={c.change} />
              <p className="muted">{c.applied ? c.reason : 'Set aside: this no longer fits your return.'}</p>
            </div>
            <button className="btn ghost small" disabled={busy === c.id} onClick={() => void undo(c.id)}>
              <Undo2 size={14} aria-hidden /> Undo
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
