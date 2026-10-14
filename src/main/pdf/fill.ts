import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import type { Cents } from '../../engine/money';
import type { FederalFormId, FederalResult } from '../../engine/federal/form1040';
import type { Form8949Sheet } from '../../engine/federal/scheduleD';
import type { TaxFacts } from '../../shared/facts';
import { FEDERAL_MAPS, SCHB_DIVIDEND_ROWS, SCHB_INTEREST_ROWS, type FormMap } from './maps/federal2025';

/** Whole dollars with commas, losses in parentheses, blank for zero (IRS: leave unused lines blank). */
export function formAmount(c: Cents): string {
  if (c === 0) return '';
  const s = Math.round(Math.abs(c) / 100).toLocaleString('en-US');
  return c < 0 ? `(${s})` : s;
}

/** Whole dollars without separators ("1234"), blank for zero — for Maryland fill-in forms. */
export function plainAmount(c: Cents): string {
  if (c === 0) return '';
  const s = String(Math.round(Math.abs(c) / 100));
  return c < 0 ? `-${s}` : s;
}

export interface FillValues {
  text: Record<string, string>;
  checks: string[];
  /** key → option, for map.choices */
  choices?: Record<string, string>;
}

/** Fill an official fillable PDF. Throws on unknown keys so a bad map can never silently drop a number. */
export async function fillPdf(template: Uint8Array, map: FormMap, values: FillValues): Promise<PDFDocument> {
  const doc = await PDFDocument.load(template); // the cantoo fork strips the IRS XFA layer on load
  const form = doc.getForm();
  for (const [key, value] of Object.entries(values.text)) {
    const name = map.text[key];
    if (!name) throw new Error(`fillPdf: no field mapped for "${key}"`);
    form.getTextField(name).setText(value);
  }
  for (const key of values.checks) {
    const name = map.checks[key];
    if (!name) throw new Error(`fillPdf: no checkbox mapped for "${key}"`);
    form.getCheckBox(name).check();
  }
  for (const [key, option] of Object.entries(values.choices ?? {})) {
    const spec = map.choices?.[key];
    const state = spec?.options[option];
    if (!spec || !state) throw new Error(`fillPdf: no choice mapped for "${key}" = "${option}"`);
    const acro = form.getCheckBox(spec.field).acroField;
    const on = PDFName.of(state);
    const widgets = acro.getWidgets();
    if (!widgets.some((w) => w.getOnValue() === on)) throw new Error(`fillPdf: "${spec.field}" has no "${state}" box`);
    acro.dict.set(PDFName.of('V'), on);
    for (const w of widgets) w.setAppearanceState(w.getOnValue() === on ? on : PDFName.of('Off'));
  }
  return doc;
}

/** "Alex & Jordan Rivera" (same last name) or "Alex Rivera & Jordan Lee". */
export function namesOnReturn(f: TaxFacts): string {
  const t = f.taxpayer;
  if (!f.spouse) return `${t.firstName} ${t.lastName}`;
  const s = f.spouse;
  return t.lastName === s.lastName
    ? `${t.firstName} & ${s.firstName} ${t.lastName}`
    : `${t.firstName} ${t.lastName} & ${s.firstName} ${s.lastName}`;
}

export const dashedSsn = (ssn: string) => `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`;

export interface Overflow {
  title: string;
  rows: { name: string; amount: Cents }[];
}

/** Fit payer rows into a fixed-size table. Overflowing payers move to an attached statement. */
export function fitRows(rows: { name: string; amount: Cents }[], capacity: number, title: string) {
  if (rows.length <= capacity) return { rows, overflow: null as Overflow | null };
  const shown = rows.slice(0, capacity - 1);
  const total = rows.slice(capacity - 1).reduce((s, r) => s + r.amount, 0);
  return { rows: [...shown, { name: 'See attached statement', amount: total }], overflow: { title, rows } };
}

/** Values for one federal form. Ledger lines are filled by matching map keys; headers and rows by hand. */
export function federalValues(id: FederalFormId, f: TaxFacts, r: FederalResult): { values: FillValues; statements: Overflow[] } {
  const map = FEDERAL_MAPS[id];
  const text: Record<string, string> = {};
  const checks: string[] = [];
  const statements: Overflow[] = [];
  for (const key of Object.keys(map.text)) if (r.ledger.has(key)) text[key] = formAmount(r.ledger.get(key));

  if (id === 'f1040') {
    Object.assign(text, {
      firstName: f.taxpayer.firstName,
      lastName: f.taxpayer.lastName,
      ssn: f.taxpayer.ssn,
      street: f.address.street,
      apt: f.address.apt ?? '',
      city: f.address.city,
      state: f.address.state,
      zip: f.address.zip,
    });
    if (f.spouse) Object.assign(text, { spouseFirstName: f.spouse.firstName, spouseLastName: f.spouse.lastName, spouseSsn: f.spouse.ssn });
    checks.push(f.filingStatus);
    if (f.digitalAssets !== null) checks.push(f.digitalAssets ? 'digitalAssetsYes' : 'digitalAssetsNo');
    if (r.line4c.rollover) checks.push('iraRollover');
    if (r.line4c.qcd) checks.push('iraQcd');
    if (r.line5c.rollover) checks.push('pensionRollover');
    if (r.line5c.pso) checks.push('pensionPso');
    if (r.line12d.you65) checks.push('youBornBefore1961');
    if (r.line12d.youBlind) checks.push('youBlind');
    if (r.line12d.spouse65) checks.push('spouseBornBefore1961');
    if (r.line12d.spouseBlind) checks.push('spouseBlind');
    // When a distribution has a $0 taxable amount (e.g. a direct rollover or full QCD) and gross > 0, IRS instructions say to enter 0 on 4b/5b.
    if (r.ledger.get('f1040.4a') > 0 && r.ledger.get('f1040.4b') === 0) text['f1040.4b'] = '0';
    if (r.ledger.get('f1040.5a') > 0 && r.ledger.get('f1040.5b') === 0) text['f1040.5b'] = '0';
    if (r.ledger.get('f1040.6a') > 0 && r.ledger.get('f1040.6b') === 0) text['f1040.6b'] = '0';
    if (r.line7bCheck) checks.push('scheduleDNotRequired');
  } else {
    text.name = namesOnReturn(f);
    text.ssn = dashedSsn(f.taxpayer.ssn);
  }

  if (id === 'sch1') {
    if (r.business.needsForm4797) checks.push('form4797');
  }

  if (id === 'schC') {
    const biz = r.business.activeBusiness;
    const owner = biz?.owner === 'spouse' && f.spouse ? f.spouse : f.taxpayer;
    text.name = `${owner.firstName} ${owner.lastName}`.trim();
    text.ssn = owner.ssn;
    text.principalBusiness = biz?.principalBusiness ?? 'Consulting services';
    text.businessCode = (biz?.businessCode ?? '541610').replace(/\D/g, '').slice(0, 6);
    if (biz?.businessName) text.businessName = biz.businessName;
    if (biz?.ein) text.ein = biz.ein.replace(/\D/g, '').slice(0, 9);
    text.street = [f.address.street, f.address.apt].filter(Boolean).join(', ');
    text.cityStateZip = [f.address.city, f.address.state, f.address.zip].filter(Boolean).join(', ');
    checks.push('accountingCash', 'materialParticipationYes', 'payments1099No');
    if (r.business.printed.simplifiedTotalSqFt) text.simplifiedTotalSqFt = r.business.printed.simplifiedTotalSqFt;
    if (r.business.printed.simplifiedBusinessSqFt) text.simplifiedBusinessSqFt = r.business.printed.simplifiedBusinessSqFt;
    if (r.ledger.get('schC.31') < 0) checks.push('allAtRisk');
    (biz?.otherExpenses ?? []).slice(0, 9).forEach((item, idx) => {
      text[`otherExp.${idx}.desc`] = item.description;
      text[`otherExp.${idx}.amt`] = formAmount(item.amount);
    });
  }

  if (id === 'schSE') {
    const biz = r.business.activeBusiness;
    const owner = biz?.owner === 'spouse' && f.spouse ? f.spouse : f.taxpayer;
    text.name = `${owner.firstName} ${owner.lastName}`.trim();
    text.ssn = dashedSsn(owner.ssn);
  }

  if (id === 'f8829') {
    const biz = r.business.activeBusiness;
    const owner = biz?.owner === 'spouse' && f.spouse ? f.spouse : f.taxpayer;
    text.name = `${owner.firstName} ${owner.lastName}`.trim();
    text.ssn = dashedSsn(owner.ssn);
    if (r.business.printed.f8829Pct3) text.pct3 = r.business.printed.f8829Pct3;
    if (r.business.printed.f8829Pct7) text.pct7 = r.business.printed.f8829Pct7;
    if (r.business.printed.f8829Pct41) text.pct41 = r.business.printed.f8829Pct41;
  }

  if (id === 'f7206') {
    if (r.business.printed.f7206Ratio6) text.ratio6 = r.business.printed.f7206Ratio6;
  }

  if (id === 'f4797') {
    // Line 11 has pre-printed parentheses on Form 4797, so print positive magnitude.
    const v11 = Math.abs(r.ledger.get('f4797.11'));
    if (v11 > 0) text['f4797.11'] = formAmount(v11);
    else delete text['f4797.11'];

    r.business.form4797.part1Rows.slice(0, 4).forEach((row, i) => {
      text[`p1.r${i}.a`] = row.description;
      text[`p1.r${i}.b`] = row.dateAcquired;
      text[`p1.r${i}.c`] = row.dateSold;
      text[`p1.r${i}.d`] = formAmount(row.salesPrice);
      text[`p1.r${i}.e`] = formAmount(row.depreciation);
      text[`p1.r${i}.f`] = formAmount(row.costBasis);
      text[`p1.r${i}.g`] = formAmount(row.gainOrLoss);
    });
    r.business.form4797.part2Rows.slice(0, 4).forEach((row, i) => {
      text[`p2.r${i}.a`] = row.description;
      text[`p2.r${i}.b`] = row.dateAcquired;
      text[`p2.r${i}.c`] = row.dateSold;
      text[`p2.r${i}.d`] = row.salesPrice === 0 ? '0' : formAmount(row.salesPrice);
      text[`p2.r${i}.e`] = formAmount(row.depreciation);
      text[`p2.r${i}.f`] = formAmount(row.costBasis);
      text[`p2.r${i}.g`] = formAmount(row.gainOrLoss);
    });
    r.business.form4797.part3Cols.slice(0, 4).forEach((col, c) => {
      text[`p3.c${c}.desc`] = col.description;
      text[`p3.c${c}.acq`] = col.dateAcquired;
      text[`p3.c${c}.sold`] = col.dateSold;
      text[`p3.c${c}.20`] = formAmount(col.line20SalesPrice);
      text[`p3.c${c}.21`] = formAmount(col.line21CostBasis);
      text[`p3.c${c}.22`] = formAmount(col.line22Depreciation);
      text[`p3.c${c}.23`] = col.line23AdjustedBasis === 0 ? '0' : formAmount(col.line23AdjustedBasis);
      text[`p3.c${c}.24`] = formAmount(col.line24TotalGain);
      text[`p3.c${c}.25a`] = formAmount(col.line25aDepr1245);
      text[`p3.c${c}.25b`] = formAmount(col.line25bRecapture1245);
    });
  }

  if (id === 'schA' && f.forceItemize && r.ledger.get('schA.17') < r.ledger.get('f1040.12e')) checks.push('forceItemize');

  if (id === 'schD') {
    const cb = r.scheduleDCheckboxes;
    checks.push(cb.qofYes ? 'qofYes' : 'qofNo');
    if (cb.line17Yes !== null) checks.push(cb.line17Yes ? 'line17Yes' : 'line17No');
    if (cb.line20Yes !== null) checks.push(cb.line20Yes ? 'line20Yes' : 'line20No');
    if (cb.line22Yes !== null) checks.push(cb.line22Yes ? 'line22Yes' : 'line22No');
    // Schedule D lines 6, 14, and 21 are printed inside pre-printed parentheses on the PDF, so print positive magnitudes.
    for (const k of ['schD.6', 'schD.14', 'schD.21'] as const) {
      const v = Math.abs(r.ledger.get(k));
      if (v > 0) text[k] = formAmount(v);
      else delete text[k];
    }
  }

  if (id === 'f8949' && r.form8949Sheets[0]) {
    return { values: form8949SheetValues(f, r.form8949Sheets[0]), statements };
  }

  if (id === 'f8995') {
    // Lines 3, 7, 16, and 17 have pre-printed parentheses on Form 8995, so print positive magnitudes.
    for (const k of ['f8995.3', 'f8995.7', 'f8995.16', 'f8995.17'] as const) {
      const v = Math.abs(r.ledger.get(k));
      if (v > 0) text[k] = formAmount(v);
      else delete text[k];
    }
  }

  if (id === 'f8995a') {
    for (const k of ['f8995a.29', 'f8995a.40'] as const) {
      const v = Math.abs(r.ledger.get(k));
      if (v > 0) text[k] = formAmount(v);
      else delete text[k];
    }
  }

  if (id === 'schE' || id === 'f8582' || id === 'f4562' || id === 'f7203') {
    for (const [k, val] of Object.entries(r.scheduleE.printed)) {
      if (typeof val === 'boolean') {
        if (val && k in map.checks) checks.push(k);
      } else if (val && k in map.text) {
        text[k] = val;
      }
    }
  }

  if (id === 'schB') {
    const interest = fitRows(r.payers.interest, SCHB_INTEREST_ROWS, 'Schedule B, Part I, line 1 (interest)');
    const dividends = fitRows(r.payers.dividends, SCHB_DIVIDEND_ROWS, 'Schedule B, Part II, line 5 (ordinary dividends)');
    interest.rows.forEach((p, i) => {
      text[`schB.1.name.${i}`] = p.name;
      text[`schB.1.amount.${i}`] = formAmount(p.amount);
    });
    dividends.rows.forEach((p, i) => {
      text[`schB.5.name.${i}`] = p.name;
      text[`schB.5.amount.${i}`] = formAmount(p.amount);
    });
    for (const o of [interest.overflow, dividends.overflow]) if (o) statements.push(o);
    const fa = f.foreignAccounts;
    checks.push(fa.hasForeignAccount ? 'foreignAccountYes' : 'foreignAccountNo');
    if (fa.hasForeignAccount) {
      checks.push(fa.fbarRequired ? 'fbarYes' : 'fbarNo');
      if (fa.fbarRequired) text.fbarCountries = fa.countries.join(', ');
    }
    checks.push(fa.foreignTrust ? 'foreignTrustYes' : 'foreignTrustNo');
  }
  return { values: { text, checks }, statements };
}

/** Build FillValues for one physical sheet of Form 8949 (Part I on page 1, Part II on page 2). */
export function form8949SheetValues(f: TaxFacts, sheet: Form8949Sheet): FillValues {
  const name = namesOnReturn(f);
  const ssn = dashedSsn(f.taxpayer.ssn);
  const text: Record<string, string> = { name, ssn, name2: name, ssn2: ssn };
  const checks: string[] = [];

  const fillPart = (partNum: 1 | 2, part: Form8949Sheet['part1']) => {
    if (!part) return;
    checks.push(`box${part.box}`);
    part.lots.forEach((lot, i) => {
      const p = `p${partNum}.r${i}`;
      text[`${p}.a`] = lot.description;
      text[`${p}.b`] = lot.dateAcquired;
      text[`${p}.c`] = lot.dateSold;
      text[`${p}.d`] = formAmount(lot.proceeds);
      text[`${p}.e`] = formAmount(lot.costBasis);
      if (lot.code) text[`${p}.f`] = lot.code;
      if (lot.adjustment !== 0) text[`${p}.g`] = formAmount(lot.adjustment);
      text[`${p}.h`] = formAmount(lot.gainOrLoss);
    });
    text[`p${partNum}.total.d`] = formAmount(part.totals.proceeds);
    text[`p${partNum}.total.e`] = formAmount(part.totals.costBasis);
    if (part.totals.adjustment !== 0) text[`p${partNum}.total.g`] = formAmount(part.totals.adjustment);
    text[`p${partNum}.total.h`] = formAmount(part.totals.gainOrLoss);
  };

  fillPart(1, sheet.part1);
  fillPart(2, sheet.part2);
  return { text, checks };
}
