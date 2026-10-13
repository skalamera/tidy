import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

/** A one-page PDF with a line of text, like a small W-2. */
async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('Wages, tips, other compensation 118400.00', {
    x: 72,
    y: 700,
    size: 12,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  return doc.save();
}

describe('showing a document page', () => {
  // Electron 39 runs Chromium 142, which has Uint8Array.prototype.toHex but no Map.prototype.getOrInsertComputed.
  // Node 24 has neither, so add only toHex: this test then sees the same gap as the app's window. pdf.js asks for the
  // page's optional content before it draws, and the modern build used getOrInsertComputed for that.
  if (!('toHex' in Uint8Array.prototype)) {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      configurable: true,
      value(this: Uint8Array) {
        return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
      },
    });
  }

  it('gets a page ready to draw without Map.prototype.getOrInsertComputed', async () => {
    expect('getOrInsertComputed' in Map.prototype).toBe(false); // checked before pdf.js loads, as in the app's window
    const { getDocument } = await import('../../src/renderer/src/pdfjs');
    const task = getDocument({ data: await samplePdf() });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    expect(page.getViewport({ scale: 1 }).width).toBe(612);
    await expect(pdf.getOptionalContentConfig()).resolves.toBeTruthy();
    await task.destroy();
  });
});
