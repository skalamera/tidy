import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

let worker: Worker | null = null;

/** Start loading PDF bytes with pdf.js. Await `.promise`; call `.destroy()` when done.
 *  The worker is inlined as a blob: URL so it also loads from file:// in the packaged app. */
export function openPdf(bytes: Uint8Array): PDFDocumentLoadingTask {
  if (!worker) {
    worker = new PdfWorker();
    GlobalWorkerOptions.workerPort = worker;
  }
  return getDocument({ data: bytes });
}

/** Draw one page (1-based) into the canvas at the given CSS width, sharp on Retina screens. */
export async function drawPage(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
}
