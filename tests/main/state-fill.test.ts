import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { usd } from '../../src/engine/money';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { fillPdf } from '../../src/main/pdf/fill';
import { STATE_MAPS, mdValues } from '../../src/main/pdf/stateValues';
import { S2, facts, int1099, r1099, ssa1099 } from '../fixtures/facts';

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

  it('fills Form 502R and Form 502CR for Maryland seniors with retirement income', async () => {
    const seniorMd = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-04-10', blind: true },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1957-08-20', totallyDisabled: true },
      f1099R: [
        r1099({ owner: 'taxpayer', iraSepSimple: false, box1GrossDistribution: usd(35_000), box2aTaxableAmount: usd(35_000) }),
        r1099({ owner: 'spouse', iraSepSimple: true, box1GrossDistribution: usd(10_000), box2aTaxableAmount: usd(10_000) }),
      ],
      ssa1099: [ssa1099({ owner: 'taxpayer', box5NetBenefits: usd(15_000) })],
    });
    const md = computeMd(seniorMd, computeFederal(seniorMd));
    expect(md.forms).toEqual(expect.arrayContaining(['md502', 'md502r', 'md502cr']));

    const v502 = mdValues('md502', seniorMd, md);
    expect(v502.checks).toEqual(
      expect.arrayContaining(['exemptYou', 'exemptSpouse', 'age65You', 'age65Spouse', 'blindYou', 'pensionExclusionYou']),
    );

    const v502r = mdValues('md502r', seniorMd, md);
    expect(v502r.text).toMatchObject({
      yourAge: '70',
      spouseAge: '68',
      'md502r.1a': '35000',
      'md502r.7b': '10000',
      'md502r.8': '45000',
      'md502r.9a': '15000',
      'md502r.11a': '26200',
    });
    expect(v502r.checks).toContain('disabledSpouse');
    const doc502r = await fillPdf(await read(STATE_MAPS.md502r.template), STATE_MAPS.md502r, v502r);
    expect(doc502r.getForm().getTextField('Text Field 25').getText()).toBe('45000');

    const v502cr = mdValues('md502cr', seniorMd, md);
    expect(v502cr.text).toMatchObject({
      firstName: 'Alex',
      lastName: 'Rivera',
      ssn: '400000001',
      spouseFirstName: 'Sam',
      spouseLastName: 'Rivera',
      spouseSsn: '400000002',
      'md502cr.M1': '1750',
      'md502cr.AA12': '1750',
      'md502cr.AA14': '1750',
    });
    const doc502cr = await fillPdf(await read(STATE_MAPS.md502cr.template), STATE_MAPS.md502cr, v502cr);
    expect(doc502cr.getForm().getTextField('Text Field 1038').getText()).toBe('1750');
  });
});
