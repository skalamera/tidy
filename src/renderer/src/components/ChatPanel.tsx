import { ArrowUp, Check, History, SquarePen, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppView, ProposalView } from '../../../core/view';
import type { SectionId } from '../../../shared/state';
import { ChangeLine } from './ChangeLine';
import { tidy } from '../api';
import { Logo } from './Brand';
import { ChatHistory } from './ChatHistory';

const STARTERS: Partial<Record<SectionId, string[]>> = {
  documents: ['What documents do I still need?', 'Can I upload a photo of a form?'],
  wages: ['What is box 12 on my W-2?', 'Why is my Medicare tax higher than 1.45%?'],
  investments: ['What makes a dividend “qualified”?', 'Is my municipal bond interest taxed?'],
  deductions: ['Should I itemize?', 'How does the $40,000 SALT cap work for me?'],
  federal_summary: ['Why do I owe the 3.8% investment tax?', 'Explain my refund in plain English'],
  state_summary: ['How is my state tax calculated?', 'Why do I pay local tax?'],
};
const DEFAULT_STARTERS = ['What happens next?', 'Explain this step in plain English'];

/** A suggestion from chat. The change itself is worded by Tidy from your return, not by the AI. */
function ProposalCard({ p, onToast }: { p: ProposalView; onToast: (t: string) => void }) {
  const decide = async (accept: boolean) => {
    const r = await tidy().decideProposal(p.id, accept);
    if (!r.ok) onToast(r.error);
  };
  const undo = async (id: string) => {
    const r = await tidy().undoOverride(id);
    if (!r.ok) onToast(r.error);
  };
  return (
    <div className={`proposal ${p.status}`}>
      <p className="eyebrow">Suggested change</p>
      <ChangeLine change={p.change} />
      {p.reason && <p className="muted">Why: {p.reason}</p>}
      {p.status === 'pending' && p.fits && (
        <div className="choices inline">
          <button className="btn primary small" onClick={() => void decide(true)}>
            <Check size={14} aria-hidden /> Make this change
          </button>
          <button className="btn ghost small" onClick={() => void decide(false)}>
            No thanks
          </button>
        </div>
      )}
      {p.status === 'pending' && !p.fits && <p className="muted">This no longer fits your return, so it can’t be made.</p>}
      {p.status === 'accepted' && (
        <div className="choices inline">
          <p className="muted">Changed.</p>
          {p.overrideId && (
            <button className="btn ghost small" onClick={() => void undo(p.overrideId!)}>
              <Undo2 size={14} aria-hidden /> Undo
            </button>
          )}
        </div>
      )}
      {p.status === 'rejected' && <p className="muted">Not changed.</p>}
      {p.status === 'undone' && <p className="muted">Changed, then undone.</p>}
    </div>
  );
}

function ChatHeader({ onClose }: { onClose: () => void }) {
  return (
    <header>
      <Logo size={28} />
      <div>
        <strong>Ask Tidy</strong>
        <span>Sees this screen and your whole return</span>
      </div>
      <button className="btn ghost small" onClick={onClose} aria-label="Close chat">
        <X size={16} />
      </button>
    </header>
  );
}

/** "Ask Tidy": the AI, with the current screen and the whole return as context. It can suggest changes, never make
 *  them. Every chat is saved: "All chats" finds, reopens and deletes them, and "New chat" starts fresh. */
export function ChatPanel({
  view,
  sectionId,
  onClose,
  onToast,
  onChangeAi,
}: {
  view: AppView;
  sectionId: SectionId;
  onClose: () => void;
  onToast: (t: string) => void;
  onChangeAi: () => void;
}) {
  const chat = view.chat;
  const [showHistory, setShowHistory] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState('');
  const end = useRef<HTMLDivElement>(null);
  // Until the first view of a brand-new chat arrives, the question is in flight with no chat to show it in yet.
  const answeringHere = (chat.busyId !== null && chat.busyId === chat.currentId) || (sending && chat.busyId === null);
  const answeringElsewhere = chat.busyId !== null && chat.busyId !== chat.currentId;

  // Only one answer is ever in progress, and only while it is does the text below show; send() clears it.
  useEffect(() => tidy().onChatDelta((d) => setStreaming((s) => s + d)), []);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [chat.currentId, chat.messages.length, streaming]);

  const send = async (message: string) => {
    if (!message.trim() || sending || chat.busyId !== null) return;
    setText('');
    setStreaming('');
    setSending(true);
    try {
      await tidy().sendChat(message.trim());
    } finally {
      setSending(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  };

  if (showHistory) {
    return (
      <aside className="chat" aria-label="Ask Tidy">
        <ChatHeader onClose={onClose} />
        <ChatHistory
          chat={chat}
          onOpen={(id) => {
            void tidy().openChat(id);
            setShowHistory(false);
          }}
          onBack={() => setShowHistory(false)}
        />
      </aside>
    );
  }

  return (
    <aside className="chat" aria-label="Ask Tidy">
      <ChatHeader onClose={onClose} />
      <div className="chat-tools">
        <button className="btn ghost small" onClick={() => setShowHistory(true)}>
          <History size={15} aria-hidden /> All chats
        </button>
        <button
          className="btn ghost small"
          onClick={() => void tidy().newChat()}
          disabled={chat.currentId === null}
          title={chat.currentId === null ? 'This is already a new chat' : 'Start a new chat. This one stays in All chats.'}
        >
          <SquarePen size={15} aria-hidden /> New chat
        </button>
      </div>
      <div className="chat-log">
        {chat.messages.length === 0 && !answeringHere && (
          <div className="starters">
            <p className="muted">Ask anything about your taxes or this screen.</p>
            {(STARTERS[sectionId] ?? DEFAULT_STARTERS).map((s) => (
              <button key={s} className="btn choice small" onClick={() => void send(s)} disabled={chat.busyId !== null}>
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.error ? ' error' : ''}`}>
            {m.text.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            {m.proposalIds.map((id) => {
              const p = view.proposals.find((x) => x.id === id);
              return p ? <ProposalCard key={id} p={p} onToast={onToast} /> : null;
            })}
            {m.error?.changeAi && (
              <button className="btn small" onClick={onChangeAi}>
                Change AI
              </button>
            )}
          </div>
        ))}
        {answeringHere && <div className="msg assistant typing">{streaming || 'Thinking…'}</div>}
        <div ref={end} />
      </div>
      <div className="chat-input">
        {answeringElsewhere && <p className="chat-note">Tidy is still answering in another chat.</p>}
        <div className="chat-input-row">
          <textarea
            aria-label="Message"
            placeholder="Ask about this screen…"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button
            className="btn primary icon"
            aria-label="Send"
            disabled={sending || chat.busyId !== null || !text.trim()}
            onClick={() => void send(text)}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
