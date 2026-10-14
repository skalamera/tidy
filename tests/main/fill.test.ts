import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { computeFederal, type FederalFormId } from '../../src/engine/federal/form1040';
import { FEDERAL_MAPS } from '../../src/main/pdf/maps/federal2025';
import { federalValues, fillPdf, fitRows, formAmount, namesOnReturn } from '../../src/main/pdf/fill';
import { buildPackage, filingSteps } from '../../src/main/pdf/package';
import { usd } from '../../src/engine/money';
import { facts, r1099, S1, S2, ssa1099, w2 } from '../fixtures/facts';
import { doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const read = (rel: string) => readFile(path.join(process.cwd(), 'resources', rel));

describe('formAmount / namesOnReturn / fitRows', () => {
  it('formats whole dollars, losses and blanks', () => {
    expect(formAmount(44_700_000)).toBe('447,000');
    expect(formAmount(-150_000)).toBe('(1,500)');
    expect(formAmount(0)).toBe('');
  });
  it('joins spouse names', () => {
    expect(namesOnReturn(S2)).toBe('Alex & Sam Rivera');
    expect(namesOnReturn(S1)).toBe('Alex Rivera');
  });
  it('moves overflow payers to a statement', () => {
    const rows = Array.from({ length: 16 }, (_, i) => ({ name: `Bank ${i + 1}`, amount: 10_000 }));
    const out = fitRows(rows, 14, 'x');
    expect(out.rows).toHaveLength(14);
    expect(out.rows[13]).toEqual({ name: 'See attached statement', amount: 30_000 });
    expect(out.overflow?.rows).toHaveLength(16);
  });
});

describe('federal form maps (2025)', () => {
  for (const id of Object.keys(FEDERAL_MAPS) as FederalFormId[]) {
    it(`${id}: every mapped field exists in the official PDF`, async () => {
      const form = (await PDFDocument.load(await read(FEDERAL_MAPS[id].template))).getForm();
      for (const name of Object.values(FEDERAL_MAPS[id].text)) expect(form.getTextField(name).getName()).toBe(name);
      for (const name of Object.values(FEDERAL_MAPS[id].checks)) expect(form.getCheckBox(name).getName()).toBe(name);
    });
  }
});

describe('fillPdf', () => {
  it('writes S2’s Form 1040 numbers into the right boxes', async () => {
    const r = computeFederal(S2);
    const filled = await fillPdf(await read(FEDERAL_MAPS.f1040.template), FEDERAL_MAPS.f1040, federalValues('f1040', S2, r).values);
    const form = filled.getForm();
    const get = (key: string) => form.getTextField(FEDERAL_MAPS.f1040.text[key]).getText();
    expect(get('f1040.11a')).toBe('447,000');
    expect(get('f1040.16')).toBe('71,884');
    expect(get('f1040.24')).toBe('75,232');
    expect(get('f1040.34')).toBe('20,938');
    expect(get('ssn')).toBe('400000001');
    expect(form.getCheckBox(FEDERAL_MAPS.f1040.checks.mfj).isChecked()).toBe(true);
    expect(form.getCheckBox(FEDERAL_MAPS.f1040.checks.single).isChecked()).toBe(false);
    expect(form.getCheckBox(FEDERAL_MAPS.f1040.checks.scheduleDNotRequired).isChecked()).toBe(true);
  });

  it('fills Schedule B payer rows and Part III', async () => {
    const r = computeFederal(S2);
    const filled = await fillPdf(await read(FEDERAL_MAPS.schB.template), FEDERAL_MAPS.schB, federalValues('schB', S2, r).values);
    const get = (key: string) => filled.getForm().getTextField(FEDERAL_MAPS.schB.text[key]).getText();
    expect(get('name')).toBe('Alex & Sam Rivera');
    expect(get('ssn')).toBe('400-00-0001');
    expect(get('schB.1.name.0')).toBe('First Bank');
    expect(get('schB.4')).toBe(formAmount(r.ledger.get('f1040.2b')));
    expect(filled.getForm().getCheckBox(FEDERAL_MAPS.schB.checks.foreignAccountNo).isChecked()).toBe(true);
  });

  it('fills Form 1040 retirement lines (4a/4b/4c, 5a/5b/5c, 6a/6b, 12d, 13b) and Schedule 1-A Part V', async () => {
    const senior = facts({
      filingStatus: 'mfj',
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400000001', dateOfBirth: '1955-01-01', blind: true },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1956-01-01', blind: false },
      w2s: [w2({ box1Wages: usd(50_000) })],
      f1099R: [
        r1099({ iraSepSimple: true, box1GrossDistribution: usd(20_000), box2aTaxableAmount: usd(20_000), qcdAmount: usd(5_000) }),
        r1099({ iraSepSimple: false, box1GrossDistribution: usd(30_000), box2aTaxableAmount: 0, box7Codes: 'G' }),
      ],
      ssa1099: [ssa1099({ box5NetBenefits: usd(24_000) })],
    });
    const r = computeFederal(senior);
    const filled1040 = await fillPdf(await read(FEDERAL_MAPS.f1040.template), FEDERAL_MAPS.f1040, federalValues('f1040', senior, r).values);
    const f1040Form = filled1040.getForm();
    const get1040 = (key: string) => f1040Form.getTextField(FEDERAL_MAPS.f1040.text[key]).getText();
    expect(get1040('f1040.4a')).toBe('20,000');
    expect(get1040('f1040.4b')).toBe('15,000');
    expect(get1040('f1040.5a')).toBe('30,000');
    expect(get1040('f1040.5b')).toBe('0');
    expect(get1040('f1040.6a')).toBe('24,000');
    expect(get1040('f1040.13b')).toBe('12,000');
    expect(f1040Form.getCheckBox(FEDERAL_MAPS.f1040.checks.iraQcd).isChecked()).toBe(true);
    expect(f1040Form.getCheckBox(FEDERAL_MAPS.f1040.checks.pensionRollover).isChecked()).toBe(true);
    expect(f1040Form.getCheckBox(FEDERAL_MAPS.f1040.checks.youBornBefore1961).isChecked()).toBe(true);
    expect(f1040Form.getCheckBox(FEDERAL_MAPS.f1040.checks.youBlind).isChecked()).toBe(true);
    expect(f1040Form.getCheckBox(FEDERAL_MAPS.f1040.checks.spouseBornBefore1961).isChecked()).toBe(true);

    const filled1A = await fillPdf(await read(FEDERAL_MAPS.sch1A.template), FEDERAL_MAPS.sch1A, federalValues('sch1A', senior, r).values);
    const get1A = (key: string) => filled1A.getForm().getTextField(FEDERAL_MAPS.sch1A.text[key]).getText();
    expect(get1A('name')).toBe('Alex & Sam Rivera');
    expect(get1A('sch1A.36a')).toBe('6,000');
    expect(get1A('sch1A.36b')).toBe('6,000');
    expect(get1A('sch1A.37')).toBe('12,000');
    expect(get1A('sch1A.38')).toBe('12,000');
  });

  it('refuses unknown keys', async () => {
    await expect(
      fillPdf(await read(FEDERAL_MAPS.f1040.template), FEDERAL_MAPS.f1040, { text: { 'f1040.99': '1' }, checks: [] }),
    ).rejects.toThrow(/no field mapped/);
  });
});

describe('buildPackage', () => {
  it('cover page + each required form, in attachment order', async () => {
    const state = stateWith({ documents: [doc('d1', [w2Extraction()])] });
    const pdf = await PDFDocument.load(await buildPackage(state, read));
    expect(pdf.getPageCount()).toBe(1 + 2); // cover + Form 1040 (2 pages)
    expect(pdf.getTitle()).toBe('2025 Tax Return');
  });

  it('builds the package when the 2024 return printed SSNs with dashes', async () => {
    const dashed = priorYear({
      taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400-00-0001' },
      spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400-00-0002' },
    });
    const state = stateWith({ documents: [doc('py', [dashed]), doc('d1', [w2Extraction()])] });
    const pdf = await PDFDocument.load(await buildPackage(state, read));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it('tells the user exactly where to mail and how to pay', () => {
    const owe = filingSteps(S1, { ...computeFederal(S1), amountOwed: 50_000, refund: 0 }).flatMap((g) => g.steps);
    expect(owe.some((s) => s.includes('irs.gov/payments'))).toBe(true);
    expect(owe.some((s) => s.includes('Louisville, KY 40293-1000'))).toBe(true);
    const refund = filingSteps(S2, computeFederal(S2)).flatMap((g) => g.steps);
    expect(refund.some((s) => s.includes('Kansas City, MO 64999-0002'))).toBe(true);
    expect(refund.some((s) => s.includes('you and your spouse both sign'))).toBe(true);
  });
});
