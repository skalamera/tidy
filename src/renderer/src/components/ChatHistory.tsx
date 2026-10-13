import { ArrowLeft, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { localDay, markPattern } from '../../../core/chatSearch';
import type { ChatSummary, ChatView } from '../../../shared/chat';
import { tidy } from '../api';
import { dayLabel, timeLabel } from '../labels';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The passage with each searched word marked, by the same rules the search uses. */
function Marked({ text, words }: { text: string; words: string }) {
  const pattern = markPattern(words);
  if (!pattern) return <>{text}</>;
  return <>{text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** Saved chats, grouped by the day each was last used, newest first. Find one by words, by dates, or both. */
export function ChatHistory({ chat, onOpen, onBack }: { chat: ChatView; onOpen: (id: string) => void; onBack: () => void }) {
  const [words, setWords] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hits, setHits] = useState<Map<string, string | null> | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const searching = words.trim() !== '' || from !== '' || to !== '';
  const saved = chat.conversations.map((c) => `${c.id}@${c.updatedAt}`).join(); // search again when chats change

  useEffect(() => {
    if (!searching) return; // results are only shown while searching, so old ones can wait for the next search
    let live = true;
    const timer = setTimeout(() => {
      void tidy()
        .searchChats({ words: words.trim(), from: from || null, to: to || null })
        .then((found) => {
          if (live) setHits(new Map(found.map((h) => [h.id, h.snippet])));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [searching, words, from, to, saved]);

  // While new results are on their way the last ones stay up; null only before the first ones arrive.
  const shown: ChatSummary[] | null = !searching ? chat.conversations : hits ? chat.conversations.filter((c) => hits.has(c.id)) : null;
  const days: { day: string; chats: ChatSummary[] }[] = [];
  for (const c of shown ?? []) {
    const day = localDay(c.updatedAt);
    const last = days[days.length - 1];
    if (last?.day === day) last.chats.push(c);
    else days.push({ day, chats: [c] });
  }
  const today = new Date();
  const clear = () => {
    setWords('');
    setFrom('');
    setTo('');
  };

  return (
    <section className="chat-history" aria-label="Your chats">
      <div className="chat-tools">
        <button className="btn ghost small" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden /> Back to chat
        </button>
      </div>
      <div className="chat-search">
        <label className="chat-search-words">
          <Search size={15} aria-hidden />
          <input
            type="search"
            aria-label="Search chats"
            placeholder="Search your chats"
            value={words}
            onChange={(e) => setWords(e.target.value)}
          />
        </label>
        <div className="chat-search-dates">
          <label>
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          {searching && (
            <button className="btn ghost small" onClick={clear}>
              Clear search
            </button>
          )}
        </div>
        {from !== '' && to !== '' && from > to && <p className="chat-note">The From date is after the To date.</p>}
      </div>
      <div className="chat-history-list">
        {shown === null ? (
          <p className="muted">Searching…</p>
        ) : shown.length === 0 ? (
          <p className="muted">
            {searching
              ? 'No chats match. Try fewer words or wider dates.'
              : 'No saved chats yet. Ask Tidy a question and it will show up here.'}
          </p>
        ) : (
          days.map(({ day, chats }) => (
            <div key={day} className="chat-day">
              <h3>{dayLabel(day, today)}</h3>
              <ul>
                {chats.map((c) => {
                  const snippet = searching ? (hits?.get(c.id) ?? null) : null;
                  return (
                    <li key={c.id} className={c.id === chat.currentId ? 'current' : undefined}>
                      {confirming === c.id ? (
                        <div className="chat-confirm">
                          <span>Delete this chat?</span>
                          <button
                            className="btn danger small"
                            onClick={() => {
                              setConfirming(null);
                              void tidy().deleteChat(c.id);
                            }}
                          >
                            Delete
                          </button>
                          <button className="btn ghost small" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </div>
                      ) : (
                        <>
                          <button className="chat-item" onClick={() => onOpen(c.id)}>
                            <strong>{c.title}</strong>
                            <span className="chat-item-meta">
                              {timeLabel(c.updatedAt)} · {plural(c.messageCount, 'message')}
                              {c.id === chat.currentId ? ' · Open now' : ''}
                            </span>
                            {snippet && (
                              <span className="chat-item-snippet">
                                <Marked text={snippet} words={words} />
                              </span>
                            )}
                          </button>
                          <button
                            className="btn ghost chat-delete"
                            aria-label={`Delete “${c.title}”`}
                            title="Delete this chat"
                            disabled={c.id === chat.busyId}
                            onClick={() => setConfirming(c.id)}
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
