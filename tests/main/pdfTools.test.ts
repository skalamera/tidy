import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { pdfTools } from '../../src/main/pdf/pdfTools';

const F1040 = path.join(process.cwd(), 'resources', 'forms', '2025', 'f1040.pdf');

describe('pdfTools', () => {
  it('counts pages and reads the text layer', async () => {
    const bytes = await readFile(F1040);
    expect(await pdfTools.pageCount(bytes)).toBe(2);
    const texts = await pdfTools.pageTexts(bytes);
    expect(texts).toHaveLength(2);
    expect(texts![0]).toContain('U.S. Individual Income Tax Return');
  });

  it('returns null for a PDF without text (a scan)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await pdfTools.pageTexts(Buffer.from(await doc.save()))).toBeNull();
  });

  it('slices a page range', async () => {
    const part = await pdfTools.slicePages(await readFile(F1040), 2, 2);
    expect(await pdfTools.pageCount(part)).toBe(1);
    expect((await pdfTools.pageTexts(part))![0]).toContain('Form 1040 (2025)');
  });
});
