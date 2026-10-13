import type { AppView } from '../core/view';
import type { SectionId } from './state';

/** What the user is looking at. Sent to main on every navigation so the chat can say "this". */
export interface ScreenContext {
  view: 'welcome' | 'api_key' | 'section';
  sectionId: SectionId | null;
  documentId: string | null;
  page: number | null;
}

export type Result = { ok: true } | { ok: false; error: string };
export type ExportResult = { ok: true; path: string } | { ok: false; error: string };

/** The ONLY surface the renderer can call (exposed by the preload as window.tidy). */
export interface TidyApi {
  getView(): Promise<AppView>;
  onView(cb: (view: AppView) => void): () => void;
  onChatDelta(cb: (delta: string) => void): () => void;
  onNavigate(cb: (sectionId: SectionId) => void): () => void;
  completeWelcome(): Promise<void>;
  skipPriorYear(): Promise<void>;
  setApiKey(key: string): Promise<Result>;
  pickFiles(): Promise<void>;
  addPaths(paths: string[]): Promise<{ added: number; duplicates: number; rejected: string[] }>;
  /** Drag-and-drop helper: absolute path of a dropped File (Electron webUtils). */
  pathForFile(file: File): string;
  retryDocument(id: string): Promise<void>;
  removeDocument(id: string): Promise<void>;
  getDocumentBytes(id: string): Promise<Uint8Array>;
  answer(questionId: string, answer: string): Promise<void>;
  approve(sectionId: SectionId): Promise<Result>;
  setScreen(ctx: ScreenContext): void;
  sendChat(text: string): Promise<void>;
  decideProposal(id: string, accept: boolean): Promise<Result>;
  exportPackage(): Promise<ExportResult>;
}

export const IPC = {
  getView: 'view:get',
  viewChanged: 'view:changed',
  chatDelta: 'chat:delta',
  navigate: 'ui:navigate',
  completeWelcome: 'onboarding:welcome',
  skipPriorYear: 'onboarding:skip-prior-year',
  setApiKey: 'settings:set-api-key',
  pickFiles: 'docs:pick',
  addPaths: 'docs:add-paths',
  retryDocument: 'docs:retry',
  removeDocument: 'docs:remove',
  getDocumentBytes: 'docs:bytes',
  answer: 'questions:answer',
  approve: 'sections:approve',
  setScreen: 'ui:screen',
  sendChat: 'chat:send',
  decideProposal: 'proposals:decide',
  exportPackage: 'export:package',
} as const;
