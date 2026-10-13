import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PDFDocumentProxy } from '../pdfjs';
import { useEffect, useRef, useState } from 'react';
import type { DocView } from '../../../core/view';
import { tidy } from '../api';
import { drawPage, openPdf } from '../pdf';

const PAGE_WIDTH = 760;
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"

/** Shows an uploaded document at a page, e.g. where a W-2 amount came from. */
export function DocViewer({
  doc,
  page,
  onPage,
  onClose,
}: {
  doc: DocView;
  page: number;
  onPage: (p: number) => void;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    let task: ReturnType<typeof openPdf> | null = null;
    void tidy()
      .getDocumentBytes(doc.id)
      .then(async (bytes) => {
        if (isPdf(bytes)) {
          task = openPdf(bytes);
          const opened = await task.promise;
          if (live) setPdf(opened);
        } else {
          url = URL.createObjectURL(new Blob([bytes as BlobPart]));
          if (live) setImageUrl(url);
        }
      })
      .catch(() => live && setError('This document can’t be shown.'));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      void task?.destroy();
    };
  }, [doc.id]);

  useEffect(() => {
    if (pdf && canvas.current)
      void drawPage(pdf, Math.min(page, pdf.numPages), canvas.current, PAGE_WIDTH).catch(() => setError('This page can’t be shown.'));
  }, [pdf, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pages = pdf?.numPages ?? doc.pageCount;
  return (
    <div className="viewer-backdrop" role="dialog" aria-modal="true" aria-label={doc.fileName} onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{doc.issuer ? `${doc.kind} · ${doc.issuer}` : doc.fileName}</strong>
          {pages > 1 && (
            <span className="pager">
              <button className="btn ghost small" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
                <ChevronLeft size={16} />
              </button>
              Page {page} of {pages}
              <button className="btn ghost small" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
                <ChevronRight size={16} />
              </button>
            </span>
          )}
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="viewer-page">
          {error && <p className="muted">{error}</p>}
          {imageUrl && <img src={imageUrl} alt={doc.fileName} style={{ width: PAGE_WIDTH }} />}
          {pdf && <canvas ref={canvas} />}
        </div>
      </div>
    </div>
  );
}
