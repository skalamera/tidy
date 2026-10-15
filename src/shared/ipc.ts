import type { AppView } from '../core/view';
import type { AiProvider } from './ai';
import type { ChatHit, ChatQuery } from './chat';
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
  /** Main had an unexpected error; the message is a plain sentence for a toast. */
  onAppError(cb: (message: string) => void): () => void;
  /** Sends an error from the screen to Tidy's log. */
  reportError(text: string): void;
  completeWelcome(): Promise<void>;
  skipPriorYear(): Promise<void>;
  setApiKey(provider: AiProvider, key: string): Promise<Result>;
  /** Asks for files and adds them; the result says what was added and why anything wasn't. */
  pickFiles(): Promise<AddResult>;
  addPaths(paths: string[]): Promise<AddResult>;
  /** Drag-and-drop helper: absolute path of a dropped File (Electron webUtils). */
  pathForFile(file: File): string;
  retryDocument(id: string): Promise<void>;
  removeDocument(id: string): Promise<void>;
  getDocumentBytes(id: string): Promise<Uint8Array>;
  answer(questionId: string, answer: string): Promise<void>;
  approve(sectionId: SectionId): Promise<Result>;
  setScreen(ctx: ScreenContext): void;
  sendChat(text: string): Promise<void>;
  newChat(): Promise<void>;
  openChat(id: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  searchChats(query: ChatQuery): Promise<ChatHit[]>;
  decideProposal(id: string, accept: boolean): Promise<Result>;
  /** Takes back a change accepted from chat. */
  undoOverride(id: string): Promise<Result>;
  exportPackage(): Promise<ExportResult>;
  /** Saves a passphrase-locked backup of the return and its documents. */
  exportBackup(passphrase: string): Promise<ExportResult>;
  /** Replaces the return with one from a backup file. */
  restoreBackup(passphrase: string): Promise<Result>;
  /** The app menu asked to back up or restore. */
  onBackupPrompt(cb: (mode: 'export' | 'restore') => void): () => void;
}

export const IPC = {
  getView: 'view:get',
  viewChanged: 'view:changed',
  chatDelta: 'chat:delta',
  navigate: 'ui:navigate',
  appError: 'app:error',
  reportError: 'app:report-error',
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
  newChat: 'chat:new',
  openChat: 'chat:open',
  deleteChat: 'chat:delete',
  searchChats: 'chat:search',
  decideProposal: 'proposals:decide',
  undoOverride: 'overrides:undo',
  exportPackage: 'export:package',
  exportBackup: 'backup:export',
  restoreBackup: 'backup:restore',
  backupPrompt: 'backup:prompt',
} as const;

/** What adding files did. `rejected` holds one plain sentence per file that wasn't added. */
export interface AddResult {
  added: number;
  duplicates: number;
  rejected: string[];
}
