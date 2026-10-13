import type { Cents } from '../engine/money';
import type {
  ClassificationT,
  DocType,
  F1098ExtractionT,
  F1099DivExtractionT,
  F1099IntExtractionT,
  PaymentExtractionT,
  PriorYearExtractionT,
  W2ExtractionT,
} from './schemas/extraction';

/** The ten steps of a return, in order. */
export const SECTION_IDS = [
  'profile',
  'documents',
  'wages',
  'investments',
  'deductions',
  'payments',
  'federal_summary',
  'state_summary',
  'final_review',
  'file',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** `paused`: Tidy couldn't work out the return, so no step can be checked or approved until that's fixed. */
export type SectionStatus = 'locked' | 'working' | 'needs_answers' | 'ready' | 'approved' | 'needs_reapproval' | 'paused';

export type DocStatus = 'queued' | 'reading' | 'done' | 'unsupported' | 'failed' | 'duplicate';

/** Result of checking one extracted amount against the PDF's own text layer. */
export type FieldCheck = 'verified' | 'unverified' | 'mismatch';

/** `firstPage` = page of the original file where this extraction's page 1 starts (for slices of a composite PDF). */
export type Extraction = { firstPage: number } & (
  | { form: 'prior_year'; data: PriorYearExtractionT }
  | { form: 'w2'; data: W2ExtractionT }
  | { form: 'f1099_int'; data: F1099IntExtractionT }
  | { form: 'f1099_div'; data: F1099DivExtractionT }
  | { form: 'f1098'; data: F1098ExtractionT }
  | { form: 'payment'; data: PaymentExtractionT }
);
export type ExtractForm = Extraction['form'];

export interface DocumentRecord {
  id: string;
  fileName: string;
  sha256: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'text/csv';
  pageCount: number;
  hasTextLayer: boolean;
  addedAt: string; // ISO
  status: DocStatus;
  classification: ClassificationT | null;
  docType: DocType | null;
  extractions: Extraction[];
  /** key = `${extractionIndex}:${fieldPath}`, e.g. "0:box1Wages" or "0:stateLines.0.stateTax" */
  fieldChecks: Record<string, FieldCheck>;
  /** Set when a later CORRECTED form replaces this one. */
  supersededBy: string | null;
  error: string | null;
}

export type QuestionKind = 'yes_no' | 'choice' | 'money' | 'text' | 'confirm_amount' | 'name' | 'ssn' | 'address';

export interface Question {
  /** Stable key: rule id ("foreign-accounts") or "confirm:<docId>:<extractionIndex>:<fieldPath>". */
  id: string;
  sectionId: SectionId;
  kind: QuestionKind;
  prompt: string;
  help: string | null;
  choices: { value: string; label: string }[] | null;
  /** For confirm_amount: the amount we read, in cents. */
  suggested: Cents | null;
  blocking: boolean;
  origin: 'rule' | 'extraction';
  answer: string | null; // "yes" | "no" | choice value | cents as string | free text
  answeredAt: string | null;
}

/** A user (or accepted AI) correction applied on top of derived facts. Path segments address array items by id. */
export interface Override {
  id: string;
  path: string[]; // e.g. ["w2s", "w2-doc1-0", "box1Wages"] or ["filingStatus"]
  value: unknown;
  reason: string;
  createdAt: string;
  createdBy: 'user' | 'ai_proposal';
}

export interface Flag {
  id: string;
  sectionId: SectionId;
  severity: 'info' | 'warning' | 'blocker';
  title: string;
  detail: string;
}

export interface Approval {
  approvedAt: string;
  snapshotHash: string;
}

/** A change the AI suggested in chat. Nothing changes until the user clicks Accept. */
export interface Proposal {
  id: string;
  sectionId: SectionId;
  description: string; // "Change Acme W-2 box 1 from $85,000 to $86,000"
  path: string[];
  value: unknown;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface AppState {
  version: 1;
  taxYear: 2025;
  createdAt: string;
  onboarding: { welcomed: boolean; priorYearSkipped: boolean };
  documents: DocumentRecord[];
  questions: Question[];
  overrides: Override[];
  approvals: Partial<Record<SectionId, Approval>>;
  /** Payers we expect this year (from last year's return); `dismissed` = "I won't get this one". */
  expected: { key: string; name: string; form: string; dismissed: boolean }[];
  /** Changes suggested in chat. Chats themselves are saved apart from the return (main/chats.ts). */
  proposals: Proposal[];
}

export function emptyState(nowIso: string): AppState {
  return {
    version: 1,
    taxYear: 2025,
    createdAt: nowIso,
    onboarding: { welcomed: false, priorYearSkipped: false },
    documents: [],
    questions: [],
    overrides: [],
    approvals: {},
    expected: [],
    proposals: [],
  };
}
