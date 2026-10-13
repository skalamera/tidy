import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { fillPdf } from '../../src/main/pdf/fill';
import { STATE_MAPS, mdValues } from '../../src/main/pdf/stateValues';
import { S2, facts, int1099 } from '../fixtures/facts';

const read = (rel: string) => readFile(path.join(process.cwd(), 'resources', rel));

const MD = facts({
  ...S2,
  residency: { state: 'MD', fullYear: true, mdCounty: 'Montgomery', mdSubdivision: { code: '1609', name: 'City of Rockville' } },
  w2s: S2.w2s.map((w) => ({ ...w, stateLines: w.stateLines.map((s) => ({ ...s, state: 'MD' })) })),
  f1099Int: [int1099({ box1Interest: usd(12_000), box3UsTreasuryInterest: usd(2_000), box8TaxExemptInterest: usd(3_000) })],
});

describe('Maryland form maps (2025)', () => {
  for (const [id, map] of Object.entries(STATE_MAPS)) {
    it(`${id}: every mapped field and choice exists in the official PDF`, async () => {
      const form = (await PDFDocument.load(await read(map.template))).getForm();
      for (const name of Object.values(map.text)) expect(form.getTextField(name).getName()).toBe(name);
      for (const name of Object.values(map.checks)) expect(form.getCheckBox(name).getName()).toBe(name);
      for (const spec of Object.values(map.choices ?? {})) {
        const onValues = form
          .getCheckBox(spec.field)
          .acroField.getWidgets()
          .map((w) => w.getOnValue()?.decodeText());
        for (const state of Object.values(spec.options)) expect(onValues).toContain(state);
      }
    });
  }
});

describe('Maryland values', () => {
  it('Form 502: subdivision, local rate, 502SU code, cents boxes', async () => {
    const md = computeMd(MD, computeFederal(MD));
    const v = mdValues('md502', MD, md);
    expect(v.text).toMatchObject({
      subdivisionCode: '1609',
      localRate: '320',
      'md502.13.code1': 'ab',
      'md502.41': '26000',
      'md502.41.cents': '00',
    });
    const doc = await fillPdf(await read(STATE_MAPS.md502.template), STATE_MAPS.md502, v);
    expect(doc.getForm().getTextField('Enter 20').getText()).toBe(String(md.ledger.get('md502.20') / 100));
  });
});
