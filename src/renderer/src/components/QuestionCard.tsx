import { useState, type FormEvent } from 'react';
import { addressAnswer, birthDate, nameAnswer, parseLines, ssnDigits } from '../../../shared/answers';
import type { Question } from '../../../shared/state';
import { parseDollars, usdExact } from '../format';

const MAX_BUTTON_CHOICES = 6;
const MAX_SEARCH_RESULTS = 8;

function MoneyForm({
  initial,
  onSubmit,
  busy,
  autoFocus = false,
  signed = false,
}: {
  initial: number | null;
  onSubmit: (cents: number) => void;
  busy: boolean;
  autoFocus?: boolean;
  /** Accepts a minus sign, for losses. */
  signed?: boolean;
}) {
  const [text, setText] = useState(initial === null ? '' : (initial / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseDollars(text, { allowNegative: signed });
    if (cents === null)
      return setError(signed ? 'Enter a dollar amount, like 1,250.00, or -1,250.00 for a loss' : 'Enter a dollar amount, like 1,250.00');
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
    words.length === 0
      ? []
      : choices
          .filter((c) => {
            const hay = `${c.label} ${c.keywords ?? ''}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          })
          .slice(0, MAX_SEARCH_RESULTS);
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

/** Several amounts (or day counts) in one answer, sent as JSON of line → cents (or days). Blank means 0. */
function LinesForm({
  lines,
  unit,
  initial,
  onSubmit,
  busy,
}: {
  lines: NonNullable<Question['choices']>;
  unit: 'money' | 'days' | 'sqft';
  initial: Record<string, number> | null;
  onSubmit: (answer: string) => void;
  busy: boolean;
}) {
  const shown = (n: number | undefined) => (n === undefined ? '' : unit === 'money' ? (n / 100).toFixed(2) : String(n));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.value, shown(initial?.[l.value])])),
  );
  const [error, setError] = useState<string | null>(null);
  const parse = (text: string): number | null => {
    const t = text.trim();
    if (t === '') return 0;
    if (unit === 'money') return parseDollars(t);
    const n = t.replace(/,/g, '');
    if (unit === 'sqft') return /^\d{1,7}$/.test(n) && Number(n) <= 1_000_000 ? Number(n) : null;
    return /^\d{1,3}$/.test(n) && Number(n) <= 366 ? Number(n) : null;
  };
  const parsed = lines.map((l) => [l.value, parse(values[l.value] ?? '')] as const);
  const total = unit === 'money' && parsed.every(([, v]) => v !== null) ? parsed.reduce((sum, [, v]) => sum + (v ?? 0), 0) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bad = lines.find((_, i) => parsed[i][1] === null);
    if (bad)
      return setError(
        unit === 'money'
          ? `Enter a dollar amount for “${bad.label}”, like 1,250.00, or leave it blank.`
          : unit === 'sqft'
            ? `Enter the square feet for “${bad.label}”, like 150.`
            : `Enter a number of days (0 to 366) for “${bad.label}”.`,
      );
    setError(null);
    onSubmit(JSON.stringify(Object.fromEntries(parsed.filter(([, v]) => (v ?? 0) > 0))));
  };
  return (
    <form className="lines-form" onSubmit={submit}>
      {lines.map((l) => (
        <label key={l.value}>
          <span>{l.label}</span>
          <span className="money-input">
            {unit === 'money' && <span aria-hidden>$</span>}
            <input
              aria-label={l.label}
              inputMode={unit === 'money' ? 'decimal' : 'numeric'}
              placeholder="0"
              value={values[l.value] ?? ''}
              onChange={(e) => setValues({ ...values, [l.value]: e.target.value })}
            />
          </span>
        </label>
      ))}
      <div className="lines-foot">
        {total !== null && <span className="lines-total">Total {usdExact(total)}</span>}
        <button className="btn primary" disabled={busy}>
          Save
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
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

/** Labeled boxes that send one answer. `check` turns the boxes into the answer, or null with `error` shown. */
function FieldsForm<K extends string>({
  fields,
  check,
  error,
  onSubmit,
  busy,
  className = '',
}: {
  fields: { key: K; label: string; inputMode?: 'numeric'; placeholder?: string; maxLength?: number }[];
  check: (values: Record<K, string>) => string | null;
  error: string;
  onSubmit: (answer: string) => void;
  busy: boolean;
  className?: string;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, ''])) as Record<K, string>);
  const [shown, setShown] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const answer = check(values);
    if (answer === null) return setShown(error);
    setShown(null);
    onSubmit(answer);
  };
  return (
    <form className={`fields-form ${className}`.trim()} onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.key} className={`field-${f.key}`}>
          {f.label}
          <input
            value={values[f.key]}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            inputMode={f.inputMode}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ))}
      <button className="btn primary" disabled={busy}>
        Save
      </button>
      {shown && (
        <p className="field-error" role="alert">
          {shown}
        </p>
      )}
    </form>
  );
}

const NAME_FIELDS = [
  { key: 'first', label: 'First name' },
  { key: 'last', label: 'Last name' },
] as const;
const SSN_FIELDS = [{ key: 'ssn', label: 'Social Security number', inputMode: 'numeric', placeholder: '123-45-6789' }] as const;
const ADDRESS_FIELDS = [
  { key: 'street', label: 'Street' },
  { key: 'apt', label: 'Apt or unit (optional)' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State', maxLength: 2 },
  { key: 'zip', label: 'ZIP code', inputMode: 'numeric' },
] as const;

const DATE_FIELDS = [{ key: 'date', label: 'Date of birth', inputMode: 'numeric', placeholder: 'MM/DD/YYYY', maxLength: 10 }] as const;

const json = (v: object | null) => (v === null ? null : JSON.stringify(v));

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
      {(q.kind === 'lines' || q.kind === 'counts' || q.kind === 'area') && q.choices && (
        <LinesForm
          lines={q.choices}
          unit={q.kind === 'lines' ? 'money' : q.kind === 'area' ? 'sqft' : 'days'}
          initial={q.answer === null ? (q.suggestedLines ?? null) : parseLines(q.answer, q.choices, q.kind)}
          busy={busy}
          onSubmit={send}
        />
      )}
      {q.kind === 'name' && (
        <FieldsForm
          fields={[...NAME_FIELDS]}
          check={(v) => json(nameAnswer(v.first, v.last))}
          error="Enter a first and a last name."
          busy={busy}
          onSubmit={send}
        />
      )}
      {q.kind === 'ssn' && (
        <FieldsForm
          fields={[...SSN_FIELDS]}
          check={(v) => ssnDigits(v.ssn)}
          error="Enter all 9 digits, like 123-45-6789."
          busy={busy}
          onSubmit={send}
        />
      )}
      {q.kind === 'date' && (
        <FieldsForm
          fields={[...DATE_FIELDS]}
          check={(v) => birthDate(v.date)}
          error="Enter the date like 04/27/1958."
          busy={busy}
          onSubmit={send}
        />
      )}
      {q.kind === 'address' && (
        <FieldsForm
          className="address-form"
          fields={[...ADDRESS_FIELDS]}
          check={(v) => json(addressAnswer(v))}
          error="Enter the street, city, a 2-letter state and a 5-digit ZIP code."
          busy={busy}
          onSubmit={send}
        />
      )}
      {q.kind === 'confirm_amount' &&
        (fixing ? (
          <MoneyForm initial={q.suggested} busy={busy} autoFocus signed={q.signed} onSubmit={(c) => send(String(c))} />
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
