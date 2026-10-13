import type { ChatHit, ChatMessage, ChatQuery, Conversation } from '../shared/chat';

/** The calendar day of an ISO time on this computer's clock, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Most recently used first; a tie goes to the newer chat. */
export const newestFirst = (a: Conversation, b: Conversation): number =>
  b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt);

/** For matching only: lower case, accents dropped, curly quotes made straight, so "don't" finds "don’t". */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

/** The words of a search, as they are matched. */
export const searchWords = (words: string): string[] => fold(words).split(/\s+/).filter(Boolean);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One search word as a pattern. A word of one or two characters (like "D" or "12") has to stand alone; a longer one
 *  can be part of a bigger word, so "holding" finds "withholding". Quotes match straight or curly. */
function wordSource(word: string): string {
  const w = escapeRe(word).replace(/'/g, "['‘’]").replace(/"/g, '["“”]');
  return word.length <= 2 ? `(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])` : w;
}

/** Every searched word in one pattern with one capture group, for marking them in a passage: passage.split(pattern)
 *  puts each match at an odd index. Null when there's nothing to mark. */
export function markPattern(words: string): RegExp | null {
  const list = searchWords(words);
  return list.length > 0 ? new RegExp(`(${list.map(wordSource).join('|')})`, 'giu') : null;
}

const BEFORE = 40;
const AFTER = 80;

/** About a line of `text` around the first match of `word`, cut at spaces, with … wherever it was cut. */
function snippet(text: string, word: RegExp): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const folded = fold(flat);
  // Folding can change the length (a ligature becomes two letters); then the passage starts at the beginning.
  const m = folded.length === flat.length ? word.exec(folded) : null;
  const hit = m?.index ?? 0;
  const length = m?.[0].length ?? 0;
  let start = Math.max(0, hit - BEFORE);
  let end = Math.min(flat.length, hit + length + AFTER);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < hit) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > hit + length) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/** The chats that match, newest first. With dates, only messages from those days count, for the words too. */
export function searchChats(chats: Conversation[], q: ChatQuery): ChatHit[] {
  const words = searchWords(q.words).map((w) => new RegExp(wordSource(w), 'u'));
  const inRange = (m: ChatMessage) => {
    const day = localDay(m.at);
    return (q.from === null || day >= q.from) && (q.to === null || day <= q.to);
  };
  const hits: ChatHit[] = [];
  for (const c of [...chats].sort(newestFirst)) {
    const messages = c.messages.filter(inRange);
    if (messages.length === 0) continue;
    const texts = messages.map((m) => fold(m.text));
    if (!words.every((w) => texts.some((t) => w.test(t)))) continue;
    const found = words.length > 0 ? messages[texts.findIndex((t) => words[0].test(t))] : null;
    hits.push({ id: c.id, snippet: found ? snippet(found.text, words[0]) : null });
  }
  return hits;
}
