import {
  Classification,
  F1098Extraction,
  F1099BExtraction,
  F1099DivExtraction,
  F1099GExtraction,
  F1099IntExtraction,
  F1099MiscExtraction,
  F1099NecExtraction,
  F1099OidExtraction,
  F1099RExtraction,
  K1Extraction,
  PaymentExtraction,
  PriorStateExtraction,
  PriorYearExtraction,
  Ssa1099Extraction,
  W2Extraction,
  type ClassificationT,
  type PartForm,
} from '../../shared/schemas/extraction';
import type { Extraction, ExtractForm } from '../../shared/state';
import type { LlmClient, Source } from './llm';
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, FORM_PROMPTS } from './prompts';

const SCHEMAS = {
  w2: W2Extraction,
  f1099_int: F1099IntExtraction,
  f1099_div: F1099DivExtraction,
  f1099_b: F1099BExtraction,
  f1099_r: F1099RExtraction,
  f1099_nec: F1099NecExtraction,
  ssa_1099: Ssa1099Extraction,
  k1: K1Extraction,
  f1098: F1098Extraction,
  payment: PaymentExtraction,
  prior_year: PriorYearExtraction,
  f1099_misc: F1099MiscExtraction,
  f1099_oid: F1099OidExtraction,
  prior_state: PriorStateExtraction,
  f1099_g: F1099GExtraction,
} as const;

export function classifyDocument(llm: LlmClient, source: Source, fileName: string): Promise<ClassificationT> {
  return llm.structured({
    role: 'classify',
    system: CLASSIFY_SYSTEM,
    source,
    schema: Classification,
    prompt: `File name: ${fileName}\nClassify this document.`,
  });
}

export async function extractForm(llm: LlmClient, form: ExtractForm, source: Source, firstPage: number): Promise<Extraction> {
  const data = await llm.structured({
    role: form === 'prior_year' ? 'extract_hard' : 'extract',
    system: EXTRACT_SYSTEM,
    source,
    schema: SCHEMAS[form],
    prompt: FORM_PROMPTS[form],
  });
  return { form, firstPage, data } as Extraction;
}

export interface PlanStep {
  form: ExtractForm;
  /** 1-based inclusive page range inside the file; null = whole file. */
  pages: [number, number] | null;
}

const PART_FORM: Partial<Record<PartForm, ExtractForm>> = {
  w2: 'w2',
  f1099_int: 'f1099_int',
  f1099_div: 'f1099_div',
  f1099_b: 'f1099_b',
  f1099_r: 'f1099_r',
  f1099_nec: 'f1099_nec',
  ssa_1099: 'ssa_1099',
  k1: 'k1',
  f1098: 'f1098',
  f1099_misc: 'f1099_misc',
  f1099_oid: 'f1099_oid',
};

/** What to extract from a classified file. An empty plan means "not supported yet". */
export function extractionPlan(c: ClassificationT): PlanStep[] {
  const fromParts = () =>
    c.parts.flatMap((p) => (PART_FORM[p.form] ? [{ form: PART_FORM[p.form]!, pages: [p.firstPage, p.lastPage] as [number, number] }] : []));
  switch (c.docType) {
    case 'prior_year_federal_return':
      return [{ form: 'prior_year', pages: null }];
    case 'prior_year_state_return':
      return [{ form: 'prior_state', pages: null }];
    case 'k1_1065':
    case 'k1_1120s':
    case 'k1_1041': {
      const steps = fromParts().filter((s) => s.form === 'k1');
      return steps.length > 1 ? steps : [{ form: 'k1', pages: null }];
    }
    case 'w2':
    case 'f1099_int':
    case 'f1099_div':
    case 'f1099_b':
    case 'f1099_r':
    case 'f1099_nec':
    case 'ssa_1099':
    case 'f1099_misc':
    case 'f1098':
    case 'f1099_g': {
      const steps = fromParts().filter((s) => s.form === c.docType);
      return steps.length > 1 ? steps : [{ form: c.docType, pages: null }];
    }
    case 'f1099_composite':
      return fromParts().filter((s) =>
        ['f1099_int', 'f1099_div', 'f1099_b', 'f1099_r', 'f1099_nec', 'f1099_misc', 'f1099_oid'].includes(s.form),
      );
    case 'property_tax_bill':
    case 'charity_receipt':
    case 'estimated_payment_record':
      return [{ form: 'payment', pages: null }];
    default:
      return [];
  }
}
