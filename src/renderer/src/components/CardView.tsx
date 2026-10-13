import { FileSearch } from 'lucide-react';
import { useState } from 'react';
import type { Card } from '../../../core/view';
import type { Evidence } from '../../../shared/facts';

/** A titled list of label → amount rows. Rows with a formula or a source open a "How we got this" panel. */
export function CardView({ card, onOpenSource }: { card: Card; onOpenSource: (e: Evidence) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <article className="card">
      <header>
        <h3>{card.title}</h3>
        {card.subtitle && <p>{card.subtitle}</p>}
      </header>
      <dl className="rows">
        {card.rows.map((r, i) => {
          const explainable = r.formula !== null || r.source !== null;
          return (
            <div key={i} className={`row${open === i ? ' open' : ''}`}>
              <dt>
                {r.label}
                {r.note && <span className="note">{r.note}</span>}
              </dt>
              <dd>
                {explainable ? (
                  <button className="amount-link" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                    {r.value}
                  </button>
                ) : (
                  r.value
                )}
              </dd>
              {open === i && (
                <div className="why">
                  <p className="eyebrow">How we got this</p>
                  {r.formula && <p>{r.formula}</p>}
                  {r.source && (
                    <button className="btn ghost small" onClick={() => onOpenSource(r.source!)}>
                      <FileSearch size={14} aria-hidden /> Show me on the document{r.source.page ? ` (page ${r.source.page})` : ''}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </dl>
    </article>
  );
}
