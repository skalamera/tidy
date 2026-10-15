import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { computeFederal, type FederalFormId } from '../../src/engine/federal/form1040';
import { FEDERAL_MAPS } from '../../src/main/pdf/maps/federal2025';
import { federalValues, fillPdf } from '../../src/main/pdf/fill';
import { usd } from '../../src/engine/money';
import type { ScheduleK1 } from '../../src/shared/facts';
import { div1099, facts, w2 } from '../fixtures/facts';

const read = (rel: string) => readFile(path.join(process.cwd(), 'resources', rel));
const k1 = (p: Partial<ScheduleK1> & Pick<ScheduleK1, 'id' | 'entityName'>): ScheduleK1 => ({
  owner: 'taxpayer',
  entityType: '1065',
  entityEin: '12-3456789',
  isMaterialParticipation: true,
  ordinaryBusinessIncome: 0,
  netRentalRealEstateIncome: 0,
  interestIncome: 0,
  ordinaryDividends: 0,
  qualifiedDividends: 0,
  netShortTermCapitalGain: 0,
  netLongTermCapitalGain: 0,
  netSection1231Gain: 0,
  ...p,
});

// TI $410,900 MFJ: an SSTB partnership in the phase-in range (83.7% applicable), a loss partnership, and a $6,000 carryforward.
const f = facts({
  filingStatus: 'mfj',
  spouse: { firstName: 'Sam', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1958-02-02' },
  w2s: [w2({ box1Wages: usd(330_000), box2FedWithheld: usd(80_000), box3SsWages: usd(176_100), box5MedicareWages: usd(330_000) })],
  f1099Div: [div1099({ box1aOrdinaryDividends: usd(9_000), box1bQualifiedDividends: usd(4_000), box5Section199aDividends: usd(3_000) })],
  k1s: [
    k1({
      id: 'k1a',
      entityName: 'Advisory Partners LLP',
      ordinaryBusinessIncome: usd(120_000),
      qbiAmount: usd(120_000),
      qbiW2Wages: usd(30_000),
      isSstb: true,
    }),
    k1({
      id: 'k1b',
      entityName: 'Widget Makers LP',
      entityEin: '98-7654321',
      ordinaryBusinessIncome: usd(-15_000),
      qbiAmount: usd(-15_000),
      qbiW2Wages: usd(8_000),
    }),
  ],
  carryovers: { capitalLossShortTerm: 0, capitalLossLongTerm: 0, qbiLoss: usd(6_000), reitPtpLoss: 0 },
});

async function filled(id: FederalFormId) {
  const r = computeFederal(f);
  const pdf = await fillPdf(await read(FEDERAL_MAPS[id].template), FEDERAL_MAPS[id], federalValues(id, f, r).values);
  const form = pdf.getForm();
  return {
    text: (key: string) => form.getTextField(FEDERAL_MAPS[id].text[key]!).getText() ?? '',
    checked: (key: string) => form.getCheckBox(FEDERAL_MAPS[id].checks[key]!).isChecked(),
  };
}

describe('Form 8995-A with Schedules A and C', () => {
  it('attaches the schedules in sequence order (55A, 55B, 55D)', () => {
    const forms = computeFederal(f).forms;
    expect(forms.indexOf('f8995aSchA')).toBe(forms.indexOf('f8995a') + 1);
    expect(forms.indexOf('f8995aSchC')).toBe(forms.indexOf('f8995a') + 2);
  });

  it('fills Parts I to IV', async () => {
    const a = await filled('f8995a');
    expect(a.text('f8995a.1a.A')).toBe('Advisory Partners LLP');
    expect(a.text('f8995a.1d.A')).toBe('12-3456789');
    expect(a.checked('f8995a.1b.A')).toBe(true);
    expect(a.checked('f8995a.1b.B')).toBe(false);
    expect(a.text('f8995a.2.A')).toBe('79,440');
    expect(a.text('f8995a.4.A')).toBe('25,110');
    expect(a.text('f8995a.24')).toBe('16.30');
    expect(a.text('f8995a.26.A')).toBe('15,345');
    expect(a.text('f8995a.16')).toBe('15,345');
    expect(a.text('f8995a.39')).toBe('15,945');
  });

  it('fills Schedule A (SSTB applicable percentage)', async () => {
    const s = await filled('f8995aSchA');
    expect(s.text('f8995aSchA.1a.A')).toBe('Advisory Partners LLP');
    expect(s.text('f8995aSchA.2.A')).toBe('120,000');
    expect(s.text('f8995aSchA.9')).toBe('0.1630');
    expect(s.text('f8995aSchA.10')).toBe('83.70');
    expect(s.text('f8995aSchA.11.A')).toBe('100,440');
  });

  it('fills Schedule C (loss netting) with magnitudes inside the printed parentheses', async () => {
    const c = await filled('f8995aSchC');
    expect(c.text('f8995aSchC.name.1')).toBe('Widget Makers LP');
    expect(c.text('f8995aSchC.1a.1')).toBe('(15,000)');
    expect(c.text('f8995aSchC.1b.0')).toBe('21,000');
    expect(c.text('f8995aSchC.1c.1')).toBe('0');
    expect(c.text('f8995aSchC.2')).toBe('6,000');
    expect(c.text('f8995aSchC.6')).toBe('0');
  });

  it('lists each business on Form 8995 line 1 below the threshold', async () => {
    const small = facts({
      k1s: [k1({ id: 'k', entityName: 'Corner Shop LLC', ordinaryBusinessIncome: usd(40_000), qbiAmount: usd(40_000) })],
    });
    const r = computeFederal(small);
    const pdf = await fillPdf(await read(FEDERAL_MAPS.f8995.template), FEDERAL_MAPS.f8995, federalValues('f8995', small, r).values);
    const get = (key: string) => pdf.getForm().getTextField(FEDERAL_MAPS.f8995.text[key]!).getText();
    expect(get('f8995.1a.0')).toBe('Corner Shop LLC');
    expect(get('f8995.1b.0')).toBe('12-3456789');
    expect(get('f8995.1c.0')).toBe('40,000');
  });
});
