import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { tidy } from '../api';

export function ApiKeyScreen() {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await tidy().setApiKey(key);
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <main className="welcome">
      <span className="logo big" aria-hidden>
        <KeyRound size={30} />
      </span>
      <h1>Connect Tidy to Claude</h1>
      <p className="lead">
        Tidy uses Claude to read your documents. Create a key at{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>{' '}
        and paste it here.
      </p>
      <form className="key-form" onSubmit={submit}>
        <input
          aria-label="Anthropic API key"
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        <button className="btn primary big" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <p className="fine">Your key is stored in your Mac’s Keychain and never shown again.</p>
    </main>
  );
}
