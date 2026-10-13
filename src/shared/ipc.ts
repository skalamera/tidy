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
  newChat(): Promise<void>;
  openChat(id: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  searchChats(query: ChatQuery): Promise<ChatHit[]>;
  decideProposal(id: string, accept: boolean): Promise<Result>;
  exportPackage(): Promise<ExportResult>;
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
  exportPackage: 'export:package',
} as const;
