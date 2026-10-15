import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfTools } from '../pipeline/ingest';

/** Real PDF helpers for the main process: pdf-lib for structure, pdf.js for text. */
export const pdfTools: PdfTools = {
  async pageCount(bytes) {
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  },

  async pageTexts(bytes) {
    // pdf.js 6 never evaluates code from a document (the old isEvalSupported switch is gone with it).
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    try {
      const doc = await task.promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      }
      const chars = pages.join('').replace(/\s/g, '').length;
      return chars < 50 ? null : pages; // a scan has (almost) no text layer
    } finally {
      await task.destroy();
    }
  },

  async slicePages(bytes, first, last) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const indexes = Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i);
    for (const page of await out.copyPages(src, indexes)) out.addPage(page);
    return Buffer.from(await out.save());
  },
};
