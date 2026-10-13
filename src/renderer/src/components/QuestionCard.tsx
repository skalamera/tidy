import { useState, type FormEvent } from 'react';
import type { Question } from '../../../shared/state';
import { parseDollars, usdExact } from '../format';

const MAX_BUTTON_CHOICES = 6;
const MAX_SEARCH_RESULTS = 8;

function MoneyForm({
  initial,
  onSubmit,
  busy,
  autoFocus = false,
}: {
  initial: number | null;
  onSubmit: (cents: number) => void;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial === null ? '' : (initial / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseDollars(text);
    if (cents === null) return setError('Enter a dollar amount, like 1,250.00');
    setError(null);
    onSubmit(cents);
  };
  return (
    <form className="money-form" onSubmit={submit}>
      <label className="money-input">
        <span aria-hidden>$</span>
        <input
          aria-label="Amount in dollars"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus={autoFocus}
        />
      </label>
      <button className="btn primary" disabled={busy}>
        Save
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ChoiceList({ choices, onPick, busy }: { choices: NonNullable<Question['choices']>; onPick: (v: string) => void; busy: boolean }) {
  const [query, setQuery] = useState('');
  if (choices.length <= MAX_BUTTON_CHOICES) {
    return (
      <div className="choices">
        {choices.map((c) => (
          <button key={c.value} className="btn choice" disabled={busy} onClick={() => onPick(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
    );
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits =
    words.length === 0 ? [] : choices.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, MAX_SEARCH_RESULTS);
  return (
    <div className="choice-search">
      <input aria-label="Search" placeholder="Start typing to search…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="choices">
        {hits.map((c) => (
          <button key={c.value} className="btn choice" disabled={busy} onClick={() => onPick(c.value)}>
            {c.label}
          </button>
        ))}
        {words.length > 0 && hits.length === 0 && <p className="muted">No matches. Try fewer letters.</p>}
      </div>
    </div>
  );
}

function TextForm({ onSubmit, busy }: { onSubmit: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <form
      className="text-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <input aria-label="Your answer" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn primary" disabled={busy || !text.trim()}>
        Save
      </button>
    </form>
  );
}

/** One question, answered in one click when possible. Money answers are sent as whole cents ("1250050"). */
export function QuestionCard({ question: q, onAnswer }: { question: Question; onAnswer: (answer: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const send = async (answer: string) => {
    setBusy(true);
    try {
      await onAnswer(answer);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`question${q.blocking ? ' blocking' : ''}`}>
      <h3>{q.prompt}</h3>
      {q.help && <p className="help">{q.help}</p>}
      {q.kind === 'yes_no' && (
        <div className="choices inline">
          <button className="btn choice" disabled={busy} onClick={() => send('yes')}>
            Yes
          </button>
          <button className="btn choice" disabled={busy} onClick={() => send('no')}>
            No
          </button>
        </div>
      )}
      {q.kind === 'choice' && q.choices && <ChoiceList choices={q.choices} onPick={send} busy={busy} />}
      {q.kind === 'money' && <MoneyForm initial={q.suggested} busy={busy} onSubmit={(c) => send(String(c))} />}
      {q.kind === 'text' && <TextForm busy={busy} onSubmit={send} />}
      {q.kind === 'confirm_amount' &&
        (fixing ? (
          <MoneyForm initial={q.suggested} busy={busy} autoFocus onSubmit={(c) => send(String(c))} />
        ) : (
          <div className="choices inline">
            <button className="btn choice" disabled={busy} onClick={() => send('yes')}>
              Yes, {q.suggested === null ? 'that’s right' : usdExact(q.suggested)} is right
            </button>
            <button className="btn choice" disabled={busy} onClick={() => setFixing(true)}>
              No, fix it
            </button>
          </div>
        ))}
    </article>
  );
}
