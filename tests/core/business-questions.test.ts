import { describe, expect, it } from 'vitest';
import { deriveFacts } from '../../src/core/deriveFacts';
import { buildView } from '../../src/core/view';
import { computeFederal } from '../../src/engine/federal/form1040';
import { usd } from '../../src/engine/money';
import type { AppState, Extraction } from '../../src/shared/state';
import { amt, answered, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const nec = (recipientName: string, amount = '40,000.00'): Extraction => ({
  form: 'f1099_nec',
  firstPage: 1,
  data: {
    payerName: 'Client LLC',
    payerEin: '12-3456789',
    recipientName,
    recipientSsnLast4: null,
    box1NonemployeeCompensation: amt(amount),
    box4FedWithheld: amt(null),
    stateLines: [],
  },
});
const ids = (s: AppState) => s.questions.map((q) => q.id);
const flagIds = (s: AppState) => buildView(s, { aiProvider: null }).flags.map((f) => f.id);
const BUSINESS = [
  'business-what',
  'business-code',
  'business-sstb',
  'business-additional-receipts',
  'business-expenses',
  'business-assets',
  'business-sep',
  'business-health-insurance',
];

describe('Schedule C from a 1099-NEC', () => {
  const s0 = () => answered(stateWith({ documents: [doc('py', [priorYear()]), doc('n1', [nec('Alex Rivera')])] }), {});

  it('asks what the business does, its code, whether it’s a specified service, and its expenses line by line', () => {
    const s = s0();
    for (const id of BUSINESS) expect(ids(s)).toContain(id);
    expect(ids(s)).not.toContain('business-owner'); // the 1099-NEC says whose it is
    const code = s.questions.find((q) => q.id === 'business-code')!;
    expect(code.choices!.length).toBeGreaterThan(250);
    expect(code.choices!.find((c) => c.value === '541600')?.label).toBe('Management, scientific, & technical consulting services (541600)');
    expect(s.questions.find((q) => q.id === 'business-expenses')).toMatchObject({ kind: 'lines' });
  });

  it('puts the answers on Schedule C, line by line, instead of all as office expense', () => {
    const s = answered(s0(), {
      'business-what': 'Graphic design',
      'business-code': '541400',
      'business-sstb': 'no',
      'business-additional-receipts': String(usd(5_000)),
      'business-expenses': JSON.stringify({ advertising: usd(1_000), supplies: usd(500), otherExpenses: usd(250) }),
      'business-assets': 'no',
      'business-sep': '0',
      'business-health-insurance': '0',
    });
    const b = deriveFacts(s).scheduleC!.find((x) => !x.closedInPriorYear)!;
    expect(b).toMatchObject({
      principalBusiness: 'Graphic design',
      businessCode: '541400',
      isSstb: false,
      additionalGrossReceipts: usd(5_000),
    });
    const r = computeFederal(deriveFacts(s));
    expect(r.ledger.get('schC.1')).toBe(usd(45_000));
    expect(r.ledger.get('schC.8')).toBe(usd(1_000));
    expect(r.ledger.get('schC.18')).toBe(0);
    expect(r.ledger.get('schC.22')).toBe(usd(500));
    expect(r.ledger.get('schC.27b')).toBe(usd(250));
    expect(flagIds(s).filter((id) => id.startsWith('business'))).toEqual([]);
  });

  it('blocks business property and car expenses Tidy can’t report yet', () => {
    const s = answered(s0(), { 'business-assets': 'yes', 'business-expenses': JSON.stringify({ carAndTruck: usd(2_000) }) });
    expect(flagIds(s)).toEqual(expect.arrayContaining(['business-assets', 'business-car']));
  });
});

describe('whose business it is', () => {
  it('asks on a joint return when nothing says, and blocks a second person’s self-employment income', () => {
    const s = answered(
      stateWith({
        documents: [
          doc('py', [
            priorYear({
              scheduleC: {
                principalBusiness: 'Consulting',
                businessCode: '541600',
                businessName: 'Rivera Consulting',
                ein: null,
                homeOfficeTotalSqFt: null,
                homeOfficeBusinessSqFt: null,
              },
            }),
          ]),
          doc('d1', [w2Extraction()]),
        ],
      }),
      { 'business-active-2025': 'yes' },
    );
    expect(ids(s)).toContain('business-owner');
    expect(ids(s)).not.toContain('business-what'); // the 2024 return said
    expect(ids(s)).not.toContain('business-code');
    expect(s.questions.find((q) => q.id === 'business-owner')?.prompt).toBe('Whose business is “Rivera Consulting”?');
    const spouses = answered(s, { 'business-owner': 'spouse' });
    expect(deriveFacts(spouses).scheduleC!.find((b) => !b.closedInPriorYear)!.owner).toBe('spouse');

    const both = answered(
      stateWith({ documents: [doc('py', [priorYear()]), doc('n1', [nec('Alex Rivera')]), doc('n2', [nec('Sam Rivera')])] }),
      {},
    );
    expect(flagIds(both)).toContain('business-two-owners');
  });

  it('lets someone without a 1099-NEC or a 2024 business report one', () => {
    const s = answered(stateWith({ documents: [doc('py', [priorYear()]), doc('d1', [w2Extraction()])] }), {});
    expect(ids(s)).toContain('business-new');
    expect(ids(s)).not.toContain('business-what');
    const yes = answered(s, { 'business-new': 'yes', 'business-additional-receipts': String(usd(12_000)) });
    expect(ids(yes)).toEqual(expect.arrayContaining(BUSINESS));
    expect(computeFederal(deriveFacts(yes)).ledger.get('schC.1')).toBe(usd(12_000));
  });
});

describe('a home office', () => {
  it('is asked about each year instead of carried over, and uses the simplified method', () => {
    const prior = priorYear({
      scheduleC: {
        principalBusiness: 'Consulting',
        businessCode: '541600',
        businessName: 'Rivera Consulting',
        ein: null,
        homeOfficeTotalSqFt: 2_000,
        homeOfficeBusinessSqFt: 200,
      },
    });
    const s0 = answered(stateWith({ documents: [doc('py', [prior]), doc('n1', [nec('Alex Rivera')])] }), { 'business-home-office': 'yes' });
    const q = s0.questions.find((x) => x.id === 'business-home-office-area')!;
    expect(q).toMatchObject({ kind: 'area', suggestedLines: { businessSqFt: 200, totalSqFt: 2_000 } });
    const s1 = answered(s0, { 'business-home-office-area': JSON.stringify({ businessSqFt: 400, totalSqFt: 2_000 }) });
    expect(computeFederal(deriveFacts(s1)).ledger.get('schC.30')).toBe(usd(1_500)); // 300 sq ft cap × $5
    const no = answered(s0, { 'business-home-office': 'no' });
    expect(deriveFacts(no).scheduleC!.find((b) => !b.closedInPriorYear)!.homeOffice).toBeNull();
  });
});
