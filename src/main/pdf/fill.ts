import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import type { Cents } from '../../engine/money';
import type { FederalFormId, FederalResult } from '../../engine/federal/form1040';
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
    // Phase 1 never files Schedule D, so capital gain distributions go straight on 7a with box 7b checked.
    if (r.ledger.get('f1040.7a') !== 0) checks.push('scheduleDNotRequired');
  } else {
    text.name = namesOnReturn(f);
    text.ssn = dashedSsn(f.taxpayer.ssn);
  }

  if (id === 'schA' && f.forceItemize && r.ledger.get('schA.17') < r.ledger.get('f1040.12e')) checks.push('forceItemize');

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
