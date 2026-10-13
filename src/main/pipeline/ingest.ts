import { createHash } from 'node:crypto';
import type { AiProvider } from '../../shared/ai';
import type { AppState, DocumentRecord, Extraction } from '../../shared/state';
import type { PriorYearExtractionT } from '../../shared/schemas/extraction';
import { expectedFromPriorYear, sameIssuer } from '../../core/expected';
import { reconcileQuestions } from '../../core/reconcile';
import type { ReturnStore } from '../store';
import type { LlmClient, Source } from '../ai/llm';
import { LlmError } from '../ai/llm';
import { classifyDocument, extractForm, extractionPlan } from '../ai/documents';
import { aiFailure } from '../ai/errors';
import { checkAllAmounts } from './verify';

/** PDF helpers, injected so tests don't need real PDFs. */
export interface PdfTools {
  pageCount(bytes: Buffer): Promise<number>;
  /** Text of each page, or null when the PDF has no text layer (a scan). */
  pageTexts(bytes: Buffer): Promise<string[] | null>;
  /** New PDF containing pages first..last (1-based, inclusive). */
  slicePages(bytes: Buffer, first: number, last: number): Promise<Buffer>;
}

export interface IngestDeps {
  store: ReturnStore;
  llm: LlmClient;
  /** Which AI `llm` is, so a failure can name it. */
  provider: AiProvider;
  pdf: PdfTools;
  now: () => string;
  newId: () => string;
}

export type MimeType = DocumentRecord['mimeType'];

export function mimeFromName(fileName: string): MimeType | null {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'pdf'
    ? 'application/pdf'
    : ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'csv'
          ? 'text/csv'
          : null;
}

function toSource(mime: MimeType, bytes: Buffer): Source {
  if (mime === 'application/pdf') return { kind: 'pdf', base64: bytes.toString('base64') };
  if (mime === 'text/csv') return { kind: 'text', text: bytes.toString('utf8') };
  return { kind: 'image', mediaType: mime, base64: bytes.toString('base64') };
}

/** Store the encrypted file and queue it. Returns the existing id if the same file was added before. */
export async function addFile(deps: IngestDeps, fileName: string, bytes: Buffer): Promise<{ id: string; duplicate: boolean }> {
  const mime = mimeFromName(fileName);
  if (!mime) throw new Error(`${fileName}: Tidy reads PDF, PNG, JPG and CSV files.`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const existing = deps.store.get().documents.find((d) => d.sha256 === sha256);
  if (existing) return { id: existing.id, duplicate: true };
  const id = deps.newId();
  await deps.store.putDocument(id, bytes);
  const pageCount = mime === 'application/pdf' ? await deps.pdf.pageCount(bytes) : 1;
  await deps.store.update((d) => {
    d.documents.push({
      id,
      fileName,
      sha256,
      mimeType: mime,
      pageCount,
      hasTextLayer: false,
      addedAt: deps.now(),
      status: 'queued',
      classification: null,
      docType: null,
      extractions: [],
      fieldChecks: {},
      supersededBy: null,
      error: null,
    });
  });
  return { id, duplicate: false };
}

function mergeExpected(d: AppState, prior: PriorYearExtractionT): void {
  for (const e of expectedFromPriorYear(prior)) {
    if (!d.expected.some((x) => x.key === e.key)) d.expected.push({ ...e, dismissed: false });
  }
}

/** Classify → extract each part → verify every amount against the page text → save. Never throws. */
export async function processDocument(deps: IngestDeps, id: string): Promise<void> {
  const setDoc = (patch: Partial<DocumentRecord>) =>
    deps.store.update((d) => {
      Object.assign(
        d.documents.find((x) => x.id === id)!,
        patch,
      );
      d.questions = reconcileQuestions(d);
    });
  try {
    await setDoc({ status: 'reading', error: null });
    const rec = deps.store.get().documents.find((x) => x.id === id)!;
    const bytes = await deps.store.getDocument(id);
    const isPdf = rec.mimeType === 'application/pdf';
    const texts = isPdf ? await deps.pdf.pageTexts(bytes) : null;
    const classification = await classifyDocument(deps.llm, toSource(rec.mimeType, bytes), rec.fileName);
    const plan = extractionPlan(classification);
    if (plan.length === 0) {
      await setDoc({ status: 'unsupported', classification, docType: classification.docType, hasTextLayer: texts !== null });
      return;
    }
    const extractions: Extraction[] = [];
    const fieldChecks: DocumentRecord['fieldChecks'] = {};
    for (const [i, step] of plan.entries()) {
      const [first, last] = step.pages ?? [1, rec.pageCount];
      const partBytes = isPdf && step.pages ? await deps.pdf.slicePages(bytes, first, last) : bytes;
      const partTexts = texts ? texts.slice(first - 1, last) : null;
      const x = await extractForm(deps.llm, step.form, toSource(rec.mimeType, partBytes), first);
      extractions.push(x);
      for (const [k, v] of Object.entries(checkAllAmounts(x.data, partTexts))) fieldChecks[`${i}:${k}`] = v;
    }
    await deps.store.update((d) => {
      const doc = d.documents.find((x) => x.id === id)!;
      Object.assign(doc, {
        status: 'done',
        classification,
        docType: classification.docType,
        extractions,
        fieldChecks,
        hasTextLayer: texts !== null,
      });
      if (classification.isCorrected && classification.issuerName) {
        for (const other of d.documents) {
          if (
            other.id !== id &&
            !other.supersededBy &&
            other.docType === doc.docType &&
            other.classification?.issuerName &&
            sameIssuer(other.classification.issuerName, classification.issuerName)
          ) {
            other.supersededBy = id;
          }
        }
      }
      const prior = extractions.find((e) => e.form === 'prior_year');
      if (prior?.form === 'prior_year') mergeExpected(d, prior.data);
      d.questions = reconcileQuestions(d);
    });
  } catch (e) {
    const message =
      e instanceof LlmError
        ? e.message
        : (aiFailure(deps.provider, e, 'document')?.text ?? 'Something went wrong reading this file. Try again, or upload a clearer copy.');
    await setDoc({ status: 'failed', error: message });
  }
}
