import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { computeFederal, type FederalFormId, type FederalResult } from '../../engine/federal/form1040';
import { formatUsd } from '../../engine/money';
import { computeStateReturn, stateTotals, type StateResult } from '../../engine/state';
import { deriveFacts } from '../../core/deriveFacts';
import type { TaxFacts } from '../../shared/facts';
import type { AppState } from '../../shared/state';
import { FEDERAL_MAPS, type FormMap } from './maps/federal2025';
import { dashedSsn, federalValues, fillPdf, form8949SheetValues, formAmount, namesOnReturn, type FillValues, type Overflow } from './fill';
import { STATE_MAPS, mdValues } from './stateValues';

const FORM_TITLE: Record<FederalFormId, string> = {
  f1040: 'Form 1040',
  sch1: 'Schedule 1',
  sch1A: 'Schedule 1-A',
  sch2: 'Schedule 2',
  sch3: 'Schedule 3',
  schA: 'Schedule A',
  schB: 'Schedule B',
  schC: 'Schedule C',
  schD: 'Schedule D',
  f8949: 'Form 8949',
  schE: 'Schedule E',
  schSE: 'Schedule SE',
  f4797: 'Form 4797',
  f8995: 'Form 8995',
  f8995a: 'Form 8995-A',
  f8959: 'Form 8959',
  f8960: 'Form 8960',
  f8582: 'Form 8582',
  f8829: 'Form 8829',
  f4562: 'Form 4562',
  f7203: 'Form 7203',
  f7206: 'Form 7206',
};

/** IRS "Where Do You File?" for Maryland residents (2025 Form 1040 instructions, p. 126). */
const IRS_MAIL = {
  noPayment: 'Department of the Treasury, Internal Revenue Service, Kansas City, MO 64999-0002',
  payment: 'Internal Revenue Service, P.O. Box 931000, Louisville, KY 40293-1000',
};
/** Maryland 2025 Resident Booklet, "Mailing your return". */
const MD_MAIL = {
  noPayment: 'Comptroller of Maryland, Revenue Administration Division, 110 Carroll Street, Annapolis, MD 21411-0001',
  payment: 'Comptroller of Maryland, Payment Processing, PO Box 8888, Annapolis, MD 21401-8888',
};

/** Plain-English "what to do next" for the cover page. Pure, so the UI shows the same steps. */
export function filingSteps(f: TaxFacts, r: FederalResult, s: StateResult | null = null): { title: string; steps: string[] }[] {
  const joint = f.filingStatus === 'mfj';
  const both = joint ? ' (you and your spouse both sign)' : '';
  const federal = [
    `Check every page. Your federal return is ${r.forms.map((id) => FORM_TITLE[id]).join(', ')}.`,
    `Sign and date page 2 of Form 1040${both}.`,
    'Attach Copy B of each Form W-2 to the front of Form 1040, page 1.',
  ];
  if (r.amountOwed > 0) {
    federal.push(
      `Pay ${formatUsd(r.amountOwed)} online at irs.gov/payments (Direct Pay is free). Paying online means no check or voucher in the envelope.`,
    );
    federal.push(`Mail the return to: ${IRS_MAIL.payment}.`);
  } else {
    federal.push(`Mail the return to: ${IRS_MAIL.noPayment}.`);
    if (r.refund > 0) federal.push(`Your ${formatUsd(r.refund)} refund comes as a paper check to your address.`);
  }
  const out = [{ title: 'Federal return', steps: federal }];
  if (s?.state === 'MD') {
    const t = s.md;
    const md = [
      `Sign and date page 4 of Form 502${both}.`,
      'Staple the state copy of each W-2 to the front of Form 502, where it says “ATTACH HERE”.',
    ];
    if (t.amountOwed > 0)
      md.push(
        `Pay ${formatUsd(t.amountOwed)} online at marylandcomptroller.gov (click “Pay”), then mail the return to: ${MD_MAIL.payment}.`,
      );
    else md.push(`Mail the return to: ${MD_MAIL.noPayment}.`);
    out.push({ title: 'Maryland return', steps: md });
  }
  out.push({ title: 'Keep', steps: ['Keep this package and your documents for at least 3 years.'] });
  return out;
}

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

class Writer {
  y = 740;
  constructor(
    private page: PDFPage,
    private font: PDFFont,
    private bold: PDFFont,
  ) {}
  text(t: string, opts: { size?: number; bold?: boolean; gap?: number; grey?: boolean } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.font;
    for (const line of wrap(t, font, size, 492)) {
      this.page.drawText(line, { x: 60, y: this.y, size, font, color: opts.grey ? rgb(0.42, 0.42, 0.46) : rgb(0.1, 0.1, 0.12) });
      this.y -= size * 1.4;
    }
    this.y -= opts.gap ?? 3;
  }
  row(label: string, value: string) {
    this.page.drawText(label, { x: 60, y: this.y, size: 10.5, font: this.font });
    this.page.drawText(value, { x: 552 - this.bold.widthOfTextAtSize(value, 10.5), y: this.y, size: 10.5, font: this.bold });
    this.y -= 16;
  }
}

async function coverPage(out: PDFDocument, f: TaxFacts, r: FederalResult, s: StateResult | null): Promise<void> {
  const page = out.addPage([612, 792]);
  const w = new Writer(page, await out.embedFont(StandardFonts.Helvetica), await out.embedFont(StandardFonts.HelveticaBold));
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
  for (const group of filingSteps(f, r, s)) {
    w.text(group.title, { bold: true, gap: 2 });
    group.steps.forEach((step, i) => w.text(`${i + 1}.  ${step}`, { gap: 2 }));
    w.y -= 6;
  }
}

async function statementPage(out: PDFDocument, f: TaxFacts, s: Overflow): Promise<void> {
  const page = out.addPage([612, 792]);
  const w = new Writer(page, await out.embedFont(StandardFonts.Helvetica), await out.embedFont(StandardFonts.HelveticaBold));
  w.text(`${namesOnReturn(f)}   ${dashedSsn(f.taxpayer.ssn)}`, { size: 10, gap: 10 });
  w.text(`Statement for ${s.title}`, { size: 14, bold: true, gap: 10 });
  for (const r of s.rows) w.row(r.name, formAmount(r.amount));
  w.y -= 6;
  w.row('Total', formAmount(s.rows.reduce((a, r) => a + r.amount, 0)));
}

/** Cover page, federal forms in attachment order, statements, then the state return — one printable PDF. */
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

  await coverPage(out, f, r, s);
  const statements: Overflow[] = [];
  for (const id of r.forms) {
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
    await append(FEDERAL_MAPS[id], values);
  }
  for (const st of statements) await statementPage(out, f, st);

  if (s?.state === 'MD') for (const id of s.md.forms) await append(STATE_MAPS[id], mdValues(id, f, s.md));
  return out.save();
}
