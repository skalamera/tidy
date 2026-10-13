import { ArrowUp, Check, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppView } from '../../../core/view';
import type { Proposal, SectionId } from '../../../shared/state';
import { tidy } from '../api';
import { Logo } from './Brand';

const STARTERS: Partial<Record<SectionId, string[]>> = {
  documents: ['What documents do I still need?', 'Can I upload a photo of a form?'],
  wages: ['What is box 12 on my W-2?', 'Why is my Medicare tax higher than 1.45%?'],
  investments: ['What makes a dividend “qualified”?', 'Is my municipal bond interest taxed?'],
  deductions: ['Should I itemize?', 'How does the $40,000 SALT cap work for me?'],
  federal_summary: ['Why do I owe the 3.8% investment tax?', 'Explain my refund in plain English'],
  state_summary: ['How is my state tax calculated?', 'Why do I pay local tax?'],
};
const DEFAULT_STARTERS = ['What happens next?', 'Explain this step in plain English'];

function ProposalCard({ p, onToast }: { p: Proposal; onToast: (t: string) => void }) {
  const decide = async (accept: boolean) => {
    const r = await tidy().decideProposal(p.id, accept);
    if (!r.ok) onToast(r.error);
  };
  return (
    <div className={`proposal ${p.status}`}>
      <p className="eyebrow">Suggested change</p>
      <strong>{p.description}</strong>
      <p className="muted">{p.reason}</p>
      {p.status === 'pending' ? (
        <div className="choices inline">
          <button className="btn primary small" onClick={() => void decide(true)}>
            <Check size={14} aria-hidden /> Make this change
          </button>
          <button className="btn ghost small" onClick={() => void decide(false)}>
            No thanks
          </button>
        </div>
      ) : (
        <p className="muted">{p.status === 'accepted' ? 'Changed.' : 'Not changed.'}</p>
      )}
    </div>
  );
}

/** "Ask Tidy": the AI, with the current screen and the whole return as context. It can suggest changes, never make them. */
export function ChatPanel({
  view,
  sectionId,
  onClose,
  onToast,
}: {
  view: AppView;
  sectionId: SectionId;
  onClose: () => void;
  onToast: (t: string) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => tidy().onChatDelta((d) => setStreaming((s) => s + d)), []);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [view.chat.length, streaming]);

  const send = async (message: string) => {
    if (!message.trim() || sending) return;
    setText('');
    setSending(true);
    try {
      await tidy().sendChat(message.trim());
    } finally {
      setSending(false);
      setStreaming('');
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(text);
    }
  };

  return (
    <aside className="chat" aria-label="Ask Tidy">
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
      <div className="chat-log">
        {view.chat.length === 0 && (
          <div className="starters">
            <p className="muted">Ask anything about your taxes or this screen.</p>
            {(STARTERS[sectionId] ?? DEFAULT_STARTERS).map((s) => (
              <button key={s} className="btn choice small" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {view.chat.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.text.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
            {m.proposalIds.map((id) => {
              const p = view.proposals.find((x) => x.id === id);
              return p ? <ProposalCard key={id} p={p} onToast={onToast} /> : null;
            })}
          </div>
        ))}
        {sending && <div className="msg assistant typing">{streaming || 'Thinking…'}</div>}
        <div ref={end} />
      </div>
      <div className="chat-input">
        <textarea
          aria-label="Message"
          placeholder="Ask about this screen…"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="btn primary icon" aria-label="Send" disabled={sending || !text.trim()} onClick={() => void send(text)}>
          <ArrowUp size={18} />
        </button>
      </div>
    </aside>
  );
}
