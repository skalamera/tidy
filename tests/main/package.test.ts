import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPackage } from '../../src/main/pdf/package';
import { amt, answered, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const read = (rel: string) => readFile(path.join(process.cwd(), 'resources', rel));

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes });
  const pdf = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    out.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return out;
}

describe('the printed package', () => {
  it('puts each voucher after its return, loose, and the cover says which pages are which', async () => {
    // $150,000 of wages with nothing withheld: both returns owe.
    const state = answered(
      stateWith({
        documents: [
          doc('py', [priorYear()]),
          doc('w', [
            w2Extraction({
              box1Wages: amt('150,000.00'),
              box2FedWithheld: amt(null),
              stateLines: [{ state: 'MD', stateWages: amt('150,000.00'), stateTax: amt('100.00') }],
            }),
          ]),
        ],
      }),
      { 'filing-status-same': 'yes' },
    );
    const texts = await pageTexts(await buildPackage(state, read));
    const cover = texts[0]!.replace(/\s+/g, ' ');
    const voucher = Number(cover.match(/leave out Form 1040-V \(page (\d+)\)/)?.[1]);
    const pv = Number(cover.match(/leave out Form PV \(page (\d+)\)/)?.[1]);
    expect(texts[voucher - 1]).toContain('1040-V');
    expect(texts[pv - 1]).toMatch(/PV/);
    const [mdFirst] = cover
      .match(/Form 502[^.]*\(pages? (\d+)/)!
      .slice(1)
      .map(Number);
    expect(texts[mdFirst! - 1]).toMatch(/502/);
    expect(voucher).toBeLessThan(mdFirst!); // the federal voucher comes after the federal return, before Maryland's
    expect(pv).toBe(texts.length); // Form PV is last
    expect(cover).toContain('Kansas City, MO 64999-0002');
    expect(cover).toContain('Attach the state copy of your W-2 from');
  });
});
