import type { AiProvider } from './ai';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  proposalIds: string[];
  /** On a reply that is really an error: shown as one, with "Change AI" when switching would help. */
  error?: { changeAi: boolean };
}

/** One saved chat. `messages` is what the panel shows. `transcript` is the raw API conversation in the format of the
 *  AI that wrote it (`transcriptBy`, null until the first answer), and it only ever goes back to that AI. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  transcript: unknown[];
  transcriptBy: AiProvider | null;
}

/** One line in the list of saved chats. */
export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** What the chat panel draws: the open chat (none means a new one) and every saved chat, newest first. */
export interface ChatView {
  currentId: string | null;
  messages: ChatMessage[];
  conversations: ChatSummary[];
  /** The chat Tidy is answering right now. */
  busyId: string | null;
}

export const NO_CHAT: ChatView = { currentId: null, messages: [], conversations: [], busyId: null };

/** Every word has to appear in the chat. Days are YYYY-MM-DD on this computer's clock, inclusive; either may be null. */
export interface ChatQuery {
  words: string;
  from: string | null;
  to: string | null;
}

/** A chat that matches and, when searching by words, the passage where they were found. */
export interface ChatHit {
  id: string;
  snippet: string | null;
}

/** A chat is named after its first question, on one line and cut to fit the list. */
export function chatTitle(firstQuestion: string): string {
  const t = firstQuestion.replace(/\s+/g, ' ').trim();
  return t.length <= 60 ? t : `${t.slice(0, 57).trimEnd()}…`;
}
