import { describe, expect, it } from 'vitest';
import { deriveFacts, latestPriorYear } from '../../src/core/deriveFacts';
import { reconcile } from '../../src/core/reconcile';
import { buildView } from '../../src/core/view';
import { extractionPlan } from '../../src/main/ai/documents';
import type { ClassificationT } from '../../src/shared/schemas/extraction';
import type { AppState, DocumentRecord, Extraction } from '../../src/shared/state';
import { amt, doc, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const cls = (p: Partial<ClassificationT>): ClassificationT => ({
  docType: 'w2',
  taxYear: 2025,
  issuerName: 'Acme Corp',
  recipientName: 'Alex Rivera',
  isCorrected: false,
  confidence: 'high',
  parts: [],
  ...p,
});
const w2doc = (id: string, p: Partial<ClassificationT> = {}, x: Extraction = w2Extraction(), extra: Partial<DocumentRecord> = {}) =>
  doc(id, [x], { docType: p.docType ?? 'w2', classification: cls(p), ...extra });
const flagIds = (s: AppState) => buildView(s, { aiProvider: null }).flags.map((f) => f.id);
const settled = (s: AppState) => {
  reconcile(s);
  return s;
};

describe('documents for another year', () => {
  it('leaves last year’s W-2 off the return and asks the user to remove it', () => {
    const s = stateWith({ documents: [w2doc('old', { taxYear: 2024 })] });
    expect(deriveFacts(s).w2s).toEqual([]);
    const v = buildView(s, { aiProvider: null });
    expect(v.flags.find((f) => f.id === 'wrong-year-form:old')).toMatchObject({ severity: 'blocker', title: '“old.pdf” is a 2024 W-2' });
  });
});

describe('the same form twice', () => {
  it('counts copies inside one file once, and blocks the same form uploaded as two files', () => {
    const copies = stateWith({ documents: [doc('d1', [w2Extraction(), w2Extraction()], { docType: 'w2', classification: cls({}) })] });
    expect(deriveFacts(copies).w2s).toHaveLength(1);
    expect(flagIds(copies).some((id) => id.startsWith('duplicate:'))).toBe(false);
    const twice = stateWith({ documents: [w2doc('a'), w2doc('b')] });
    expect(flagIds(twice)).toContain('duplicate:b:0');
    const different = stateWith({ documents: [w2doc('a'), w2doc('b', {}, w2Extraction({ employeeName: 'Sam Rivera' }))] });
    expect(flagIds(different).some((id) => id.startsWith('duplicate:'))).toBe(false);
  });
});

describe('corrected forms', () => {
  const corrected = (recipientName: string) =>
    w2doc('c', { isCorrected: true, recipientName }, w2Extraction({ box1Wages: amt('86,000.00') }), {
      addedAt: '2026-10-14T12:00:00.000Z',
    });

  it('replace the same person’s form from that issuer, never the other spouse’s', () => {
    const s = settled(
      stateWith({
        documents: [
          w2doc('mine'),
          w2doc('theirs', { recipientName: 'Sam Rivera' }, w2Extraction({ employeeName: 'Sam Rivera' })),
          corrected('Alex Rivera'),
        ],
      }),
    );
    expect(s.documents.map((d) => [d.id, d.supersededBy])).toEqual([
      ['mine', 'c'],
      ['theirs', null],
      ['c', null],
    ]);
  });

  it('bring the original back when the correction is removed', () => {
    const s = settled(stateWith({ documents: [w2doc('mine'), corrected('Alex Rivera')] }));
    expect(s.documents[0].supersededBy).toBe('c');
    const removed = settled({ ...s, documents: s.documents.filter((d) => d.id !== 'c') });
    expect(removed.documents[0].supersededBy).toBeNull();
    expect(deriveFacts(removed).w2s).toHaveLength(1);
  });
});

describe('last year’s state return on its own', () => {
  it('fills in what the federal package left out', () => {
    const fed = priorYear({ mdCounty: null, mdSubdivisionCode: null, stateTotalTax: amt(null) });
    const md: Extraction = {
      form: 'prior_state',
      firstPage: 1,
      data: {
        taxYear: 2024,
        state: 'MD',
        mdCounty: 'Montgomery',
        mdSubdivisionCode: '1609',
        stateTotalTax: amt('6,200.00'),
        stateBalanceDue: amt(null),
        stateAppliedToNextYear: amt('300.00'),
      },
    };
    const s = stateWith({ documents: [doc('py', [fed]), doc('md', [md], { docType: 'prior_year_state_return' })] });
    expect(latestPriorYear(s)).toMatchObject({ mdCounty: 'Montgomery', mdSubdivisionCode: '1609', stateTotalTax: { amount: '6,200.00' } });
    expect(deriveFacts(s).stateReturn.priorYearMdTax).toBe(620_000);
    expect(extractionPlan(cls({ docType: 'prior_year_state_return' }))).toEqual([{ form: 'prior_state', pages: null }]);
  });
});

describe('1099-MISC and 1099-OID inside a brokerage composite', () => {
  const misc = (other: string | null): Extraction => ({
    form: 'f1099_misc',
    firstPage: 3,
    data: {
      payerName: 'Example Brokerage',
      recipientName: 'Alex Rivera',
      box1Rents: amt(null),
      box2Royalties: amt('0.00'),
      box3OtherIncome: amt(other),
      box4FedWithheld: amt(null),
      box8SubstitutePayments: amt(null),
      box10GrossProceedsToAttorney: amt(null),
    },
  });
  const oid: Extraction = {
    form: 'f1099_oid',
    firstPage: 4,
    data: {
      payerName: 'Example Brokerage',
      recipientName: 'Alex Rivera',
      box1OriginalIssueDiscount: amt('120.00'),
      box2OtherPeriodicInterest: amt('30.00'),
      box4FedWithheld: amt(null),
      box5MarketDiscount: amt(null),
      box6AcquisitionPremium: amt(null),
      box8OidOnTreasury: amt('50.00'),
      box11TaxExemptOid: amt(null),
    },
  };

  it('reads them instead of blocking the whole statement', () => {
    expect(
      extractionPlan(
        cls({
          docType: 'f1099_composite',
          parts: [
            { form: 'f1099_misc', firstPage: 3, lastPage: 3 },
            { form: 'f1099_oid', firstPage: 4, lastPage: 4 },
          ],
        }),
      ).map((s) => s.form),
    ).toEqual(['f1099_misc', 'f1099_oid']);
  });

  it('treats original issue discount as interest, and blocks only a 1099-MISC that has amounts', () => {
    const s = stateWith({
      documents: [
        doc('b', [misc('0.00'), oid], {
          docType: 'f1099_composite',
          classification: cls({ docType: 'f1099_composite', issuerName: 'Example Brokerage' }),
        }),
      ],
    });
    expect(deriveFacts(s).f1099Int).toMatchObject([
      { payerName: 'Example Brokerage (OID)', box1Interest: 15_000, box3UsTreasuryInterest: 5_000 },
    ]);
    expect(flagIds(s).filter((id) => id.startsWith('misc:') || id.startsWith('part:'))).toEqual([]);
    const withIncome = stateWith({
      documents: [doc('b', [misc('500.00')], { docType: 'f1099_composite', classification: cls({ docType: 'f1099_composite' }) })],
    });
    expect(flagIds(withIncome)).toContain('misc:b:0');
  });
});
