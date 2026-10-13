// The pdf.js the window uses to show documents. Kept in one place so a test can load exactly this build.
// The legacy build, like the main process uses: the modern one calls Map.prototype.getOrInsertComputed, which
// Electron 39's Chromium 142 doesn't have, so every page failed with "This page can't be shown." The worker in
// pdf.ts must come from the same build.
export { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
export type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
