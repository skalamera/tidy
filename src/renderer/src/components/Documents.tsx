import type { AddResult } from '../../../shared/ipc';
import { addResultText } from '../format';
import { FilePlus2, FileText, LoaderCircle, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import type { DocView } from '../../../core/view';
import { tidy } from '../api';

const STATUS: Record<DocView['status'], string> = {
  queued: 'Waiting to be read',
  reading: 'Reading…',
  done: 'Read',
  unsupported: 'Not supported yet',
  failed: 'Couldn’t read',
  duplicate: 'Duplicate',
};

/** Drop zone plus the list of everything uploaded. Dropped files go to main as absolute paths. */
export function Documents({
  docs,
  hasApiKey,
  onOpen,
  onToast,
}: {
  docs: DocView[];
  hasApiKey: boolean;
  onOpen: (id: string) => void;
  onToast: (text: string) => void;
}) {
  const [over, setOver] = useState(false);
  const report = (r: AddResult) => {
    const text = addResultText(r);
    if (text) onToast(text);
  };
  const drop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => tidy().pathForFile(f)).filter(Boolean);
    if (paths.length) report(await tidy().addPaths(paths));
  };
  return (
    <section className="documents">
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <Upload size={28} aria-hidden />
        <strong>Drop tax documents here</strong>
        <p>Last year’s return, W-2s, 1099s, 1098s, property tax bills and payment confirmations. PDFs or photos.</p>
        <button className="btn primary" onClick={() => void tidy().pickFiles().then(report)}>
          <FilePlus2 size={16} aria-hidden /> Choose files
        </button>
      </div>
      {docs.length > 0 && (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className={`doc status-${d.status}${d.superseded ? ' superseded' : ''}`}>
              <button className="doc-open" onClick={() => onOpen(d.id)}>
                <FileText size={18} aria-hidden />
                <span>
                  <strong>{d.issuer ? `${d.kind} · ${d.issuer}` : d.kind}</strong>
                  <span className="muted">{d.fileName}</span>
                </span>
              </button>
              <span className="doc-status">
                {d.status === 'reading' && <LoaderCircle size={14} className="spin" aria-hidden />}
                {d.superseded
                  ? 'Replaced by a corrected form'
                  : d.status === 'queued' && !hasApiKey
                    ? 'Waiting for your API key'
                    : STATUS[d.status]}
              </span>
              {d.error && <span className="doc-error">{d.error}</span>}
              <span className="doc-actions">
                {d.status === 'failed' && (
                  <button className="btn ghost small" onClick={() => void tidy().retryDocument(d.id)}>
                    <RotateCcw size={14} aria-hidden /> Try again
                  </button>
                )}
                <button
                  className="btn ghost small"
                  aria-label={`Remove ${d.fileName}`}
                  onClick={() => {
                    if (window.confirm(`Remove “${d.fileName}”? Numbers from it will be taken out of your return.`))
                      void tidy().removeDocument(d.id);
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
