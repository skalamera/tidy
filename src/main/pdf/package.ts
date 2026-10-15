import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { computeFederal, type FederalFormId, type FederalResult } from '../../engine/federal/form1040';
import { formatUsd } from '../../engine/money';
import { computeStateReturn, stateTotals, type StateResult } from '../../engine/state';
import type { MdFormId } from '../../engine/md/form502';
import { deriveFacts } from '../../core/deriveFacts';
import type { TaxFacts } from '../../shared/facts';
import type { AppState } from '../../shared/state';
import { FEDERAL_MAPS, type FormMap } from './maps/federal2025';
import { dashedSsn, federalValues, fillPdf, form8949SheetValues, formAmount, namesOnReturn, type FillValues, type Overflow } from './fill';
import { STATE_MAPS, mdValues } from './stateValues';

const FORM_TITLE: Record<FederalFormId, string> = {
  f1040: 'Form 1040',
  f1040v: 'Form 1040-V',
  sch1: 'Schedule 1',
  sch1A: 'Schedule 1-A',
  sch2: 'Schedule 2',
  sch3: 'Schedule 3',
  f2210: 'Form 2210',
  schA: 'Schedule A',
  schB: 'Schedule B',
  schC: 'Schedule C',
  schD: 'Schedule D',
  f8949: 'Form 8949',
  schE: 'Schedule E',
  schSE: 'Schedule SE',
  f4797: 'Form 4797',
  f6251: 'Form 6251',
  f8995: 'Form 8995',
  f8995a: 'Form 8995-A',
  f8995aSchA: 'Schedule A (Form 8995-A)',
  f8995aSchC: 'Schedule C (Form 8995-A)',
  f8959: 'Form 8959',
  f8960: 'Form 8960',
  f8582: 'Form 8582',
  f8829: 'Form 8829',
  f4562: 'Form 4562',
  f7203: 'Form 7203',
  f7206: 'Form 7206',
};

/** IRS "Where Do You File?" for Maryland residents (2025 Form 1040 instructions, p. 126). Paying online counts as
 *  not enclosing a payment. */
const IRS_MAIL = {
  noPayment: 'Department of the Treasury, Internal Revenue Service, Kansas City, MO 64999-0002',
  payment: 'Internal Revenue Service, P.O. Box 931000, Louisville, KY 40293-1000',
};
/** Maryland 2025 Resident Booklet, "Mailing your return". */
const MD_MAIL = {
  noPayment: 'Comptroller of Maryland, Revenue Administration Division, 110 Carroll Street, Annapolis, MD 21411-0001',
  payment: 'Comptroller of Maryland, Payment Processing, PO Box 8888, Annapolis, MD 21401-8888',
};

/** Where things are in the printed package (1-based page numbers), when known. */
export interface PackagePages {
  federal: [number, number];
  voucher: number | null;
  state: [number, number] | null;
  stateVoucher: number | null;
}

const pagesText = ([a, b]: [number, number]) => (a === b ? `page ${a}` : `pages ${a}–${b}`);
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** Plain-English "what to do next" for the cover page. Pure, so the UI can show the same steps. */
export function filingSteps(
  f: TaxFacts,
  r: FederalResult,
  s: StateResult | null = null,
  pages: PackagePages | null = null,
): { title: string; steps: string[] }[] {
  const joint = f.filingStatus === 'mfj';
  const both = joint ? ' (you and your spouse both sign)' : '';
  const where = (p: [number, number] | null | undefined) => (p ? ` (${pagesText(p)} of this package)` : '');
  const fedForms = r.forms.filter((id) => id !== 'f1040v').map((id) => FORM_TITLE[id]);
  const federal = [
    `Check every page. Your federal return is ${list(fedForms)}${where(pages?.federal)}.`,
    `Sign and date page 2 of Form 1040${both}.`,
  ];
  const withheld1099R = (f.f1099R ?? []).filter((x) => x.box4FedWithheld > 0).map((x) => x.payerName);
  federal.push(
    withheld1099R.length > 0
      ? `Attach Copy B of each Form W-2, and the 1099-R from ${list(withheld1099R)} (it shows federal tax withheld), to the front of Form 1040, page 1.`
      : 'Attach Copy B of each Form W-2 to the front of Form 1040, page 1.',
  );
  if (r.amountOwed > 0) {
    const voucher = pages?.voucher ? ` (page ${pages.voucher})` : '';
    federal.push(
      `To pay the ${formatUsd(r.amountOwed)} you owe online at irs.gov/payments (Direct Pay is free): leave out Form 1040-V${voucher} and mail the return to ${IRS_MAIL.noPayment}.`,
      `To pay by check or money order instead: make it payable to “United States Treasury” and write your phone number, ${joint ? 'the first Social Security number on the return' : 'your Social Security number'} and “2025 Form 1040” on it. Put it and Form 1040-V${voucher} loose in the envelope, not stapled, and mail them with the return to ${IRS_MAIL.payment}.`,
    );
  } else {
    federal.push(`Mail the return to ${IRS_MAIL.noPayment}.`);
    if (r.refund > 0) federal.push(`Your ${formatUsd(r.refund)} refund comes as a paper check to your address.`);
  }
  federal.push('The return is due April 15, 2026, or October 15, 2026 if you got an extension.');
  const out = [{ title: 'Federal return', steps: federal }];
  if (s?.state === 'MD') {
    const t = s.md;
    const mdWithheld = [
      ...f.w2s.filter((w) => w.stateLines.some((x) => x.state === 'MD' && x.stateTax > 0)).map((w) => `W-2 from ${w.employerName}`),
      ...(f.f1099R ?? [])
        .filter((x) => x.stateLines.some((l) => l.state === 'MD' && l.stateTax > 0))
        .map((x) => `1099-R from ${x.payerName}`),
      ...(f.f1099Nec ?? [])
        .filter((x) => x.stateLines.some((l) => l.state === 'MD' && l.stateTax > 0))
        .map((x) => `1099-NEC from ${x.payerName}`),
      ...(f.f1099G ?? [])
        .filter((x) => x.stateLines.some((l) => l.state === 'MD' && l.stateTax > 0))
        .map((x) => `1099-G from ${x.payerName}`),
    ];
    const md = [
      `Your Maryland return is ${list(t.forms.filter((id) => id !== 'mdpv').map((id) => MD_TITLE[id]))}${where(pages?.state)}. Sign and date page 4 of Form 502${both}.`,
      ...(mdWithheld.length > 0
        ? [
            `Attach the state copy of your ${list(mdWithheld)} to the front of Form 502. Maryland gives credit for tax withheld only with these attached.`,
          ]
        : []),
    ];
    if (t.amountOwed > 0) {
      const pv = pages?.stateVoucher ? ` (page ${pages.stateVoucher})` : '';
      md.push(
        `To pay the ${formatUsd(t.amountOwed)} you owe online at marylandcomptroller.gov: leave out Form PV${pv} and mail the return to ${MD_MAIL.noPayment}.`,
        `To pay by check or money order instead: make it payable to “Comptroller of Maryland”, clip it to Form PV${pv} (not to Form 502), put Form PV on top of Form 502 and mail them to ${MD_MAIL.payment}.`,
      );
    } else md.push(`Mail the return to ${MD_MAIL.noPayment}.`);
    md.push('Mail the Maryland return in its own envelope, not with the federal return.');
    out.push({ title: 'Maryland return', steps: md });
  }
  out.push({ title: 'Keep', steps: ['Keep this package and your documents for at least 3 years.'] });
  return out;
}

const MD_TITLE: Record<MdFormId, string> = {
  md502: 'Form 502',
  md502su: 'Form 502SU',
  md502cg: 'Form 502CG',
  md502r: 'Form 502R',
  md502cr: 'Form 502CR',
  md500dm: 'Form 500DM',
  md502up: 'Form 502UP',
  mdpv: 'Form PV',
};

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Lays out text top to bottom, starting a new page when one fills up. `pageAt(i)` gives the i-th page to draw on,
 *  or null to only measure. */
class Writer {
  y = TOP;
  pages = 1;
  constructor(
    private font: PDFFont,
    private bold: PDFFont,
    private pageAt: (index: number) => PDFPage | null,
  ) {}
  private room(height: number) {
    if (this.y - height < BOTTOM) {
      this.pages += 1;
      this.y = TOP;
    }
  }
  private get page() {
    return this.pageAt(this.pages - 1);
  }
  text(t: string, opts: { size?: number; bold?: boolean; gap?: number; grey?: boolean } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.font;
    for (const line of wrap(t, font, size, 492)) {
      this.room(size * 1.4);
      this.page?.drawText(line, { x: 60, y: this.y, size, font, color: opts.grey ? rgb(0.42, 0.42, 0.46) : rgb(0.1, 0.1, 0.12) });
      this.y -= size * 1.4;
    }
    this.y -= opts.gap ?? 3;
  }
  row(label: string, value: string) {
    this.room(16);
    this.page?.drawText(label, { x: 60, y: this.y, size: 10.5, font: this.font });
    this.page?.drawText(value, { x: 552 - this.bold.widthOfTextAtSize(value, 10.5), y: this.y, size: 10.5, font: this.bold });
    this.y -= 16;
  }
}
const TOP = 740;
const BOTTOM = 50;

/** The cover: totals and what to do next. Drawn on `pageAt` pages; returns how many it took. */
function writeCover(w: Writer, f: TaxFacts, r: FederalResult, s: StateResult | null, pages: PackagePages): number {
  w.text('Your 2025 tax return', { size: 22, bold: true, gap: 2 });
  w.text(`${namesOnReturn(f)} · prepared with Tidy`, { size: 9.5, grey: true, gap: 14 });
  const money = (label: string, t: { totalTax: number; refund: number; amountOwed: number }) => {
    w.text(label, { size: 12, bold: true, gap: 4 });
    w.row('Total tax', formatUsd(t.totalTax));
    w.row(t.refund > 0 ? 'Refund' : 'Amount you owe', formatUsd(t.refund > 0 ? t.refund : t.amountOwed));
    w.y -= 6;
  };
  money('Federal', r);
  if (s) money('Maryland', stateTotals(s));
  w.y -= 6;
  w.text('What to do next', { size: 14, bold: true, gap: 6 });
  for (const group of filingSteps(f, r, s, pages)) {
    w.text(group.title, { bold: true, gap: 2 });
    group.steps.forEach((step, i) => w.text(`${i + 1}.  ${step}`, { gap: 2 }));
    w.y -= 6;
  }
  return w.pages;
}

/** Inserts the cover at the front. Page numbers in `body` count from the first page after a one-page cover; a longer
 *  cover shifts them, so it's measured first. */
async function coverPages(out: PDFDocument, f: TaxFacts, r: FederalResult, s: StateResult | null, body: PackagePages): Promise<void> {
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const shift =
    (n: number) =>
    (p: PackagePages): PackagePages => ({
      federal: [p.federal[0] + n, p.federal[1] + n],
      voucher: p.voucher === null ? null : p.voucher + n,
      state: p.state ? [p.state[0] + n, p.state[1] + n] : null,
      stateVoucher: p.stateVoucher === null ? null : p.stateVoucher + n,
    });
  let count = 1;
  for (let i = 0; i < 3; i++) {
    const needed = writeCover(new Writer(font, bold, () => null), f, r, s, shift(count - 1)(body));
    if (needed === count) break;
    count = needed;
  }
  const covers = Array.from({ length: count }, (_, i) => out.insertPage(i, [612, 792]));
  writeCover(new Writer(font, bold, (i) => covers[i] ?? null), f, r, s, shift(count - 1)(body));
}

async function statementPage(out: PDFDocument, f: TaxFacts, s: Overflow): Promise<void> {
  const created: PDFPage[] = [];
  const pageAt = (i: number) => created[i] ?? (created[i] = out.addPage([612, 792]));
  const w = new Writer(await out.embedFont(StandardFonts.Helvetica), await out.embedFont(StandardFonts.HelveticaBold), pageAt);
  w.text(`${namesOnReturn(f)}   ${dashedSsn(f.taxpayer.ssn)}`, { size: 10, gap: 10 });
  w.text(`Statement for ${s.title}`, { size: 14, bold: true, gap: 10 });
  for (const r of s.rows) w.row(r.name, formAmount(r.amount));
  w.y -= 6;
  w.row('Total', formAmount(s.rows.reduce((a, r) => a + r.amount, 0)));
}

/** Cover page, federal forms in attachment order, statements, Form 1040-V, then the state return and Form PV: one
 *  printable PDF. Vouchers go after their return because they're mailed loose, not attached. */
export async function buildPackage(state: AppState, readResource: (rel: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const f = deriveFacts(state);
  const r = computeFederal(f);
  const s = computeStateReturn(f, r);
  const out = await PDFDocument.create();
  out.setTitle('2025 Tax Return');
  out.setCreator('Tidy');
  const append = async (map: FormMap, values: FillValues) => {
    const filled = await fillPdf(await readResource(map.template), map, values);
    filled.getForm().flatten();
    const indices = map.pages ?? filled.getPageIndices();
    for (const p of await out.copyPages(filled, indices)) out.addPage(p);
  };
  // Page numbers count the cover page, which is added first in the printed order but built last.
  const next = () => out.getPageCount() + 2;
  const last = () => out.getPageCount() + 1;

  const fedStart = next();
  const statements: Overflow[] = [];
  for (const id of r.forms) {
    if (id === 'f1040v') continue;
    if (id === 'f8949') {
      for (const sheet of r.form8949Sheets) {
        const pages = [...(sheet.part1 ? [0] : []), ...(sheet.part2 ? [1] : [])];
        await append({ ...FEDERAL_MAPS.f8949, pages: pages.length > 0 ? pages : [0, 1] }, form8949SheetValues(f, sheet));
      }
      continue;
    }
    const { values, statements: extra } = federalValues(id, f, r);
    statements.push(...extra);
    if (id === 'schE') {
      const pages = r.scheduleE.needsScheduleEPage2 ? [0, 1] : [0];
      await append({ ...FEDERAL_MAPS.schE, pages }, values);
      continue;
    }
    if (id === 'f2210') {
      await append({ ...FEDERAL_MAPS.f2210, pages: r.form2210.pages }, values);
      continue;
    }
    await append(FEDERAL_MAPS[id], values);
  }
  for (const st of statements) await statementPage(out, f, st);
  const federal: [number, number] = [fedStart, last()];
  let voucher: number | null = null;
  if (r.forms.includes('f1040v')) {
    voucher = next();
    await append(FEDERAL_MAPS.f1040v, federalValues('f1040v', f, r).values);
  }

  let stateRange: [number, number] | null = null;
  let stateVoucher: number | null = null;
  if (s?.state === 'MD') {
    const mdStart = next();
    for (const id of s.md.forms) if (id !== 'mdpv') await append(STATE_MAPS[id], mdValues(id, f, s.md));
    stateRange = [mdStart, last()];
    if (s.md.forms.includes('mdpv')) {
      stateVoucher = next();
      await append(STATE_MAPS.mdpv, mdValues('mdpv', f, s.md));
    }
  }
  await coverPages(out, f, r, s, { federal, voucher, state: stateRange, stateVoucher });
  return out.save();
}
