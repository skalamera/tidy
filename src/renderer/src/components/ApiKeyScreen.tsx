import { ArrowLeft, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AI_NAMES, AI_PROVIDERS, type AiProvider } from '../../../shared/ai';
import { tidy } from '../api';

/** Where each AI's keys come from, and how its key field is labeled. */
const KEYS: Record<AiProvider, { url: string; site: string; label: string; placeholder: string }> = {
  anthropic: {
    url: 'https://console.anthropic.com/settings/keys',
    site: 'console.anthropic.com',
    label: 'Anthropic API key',
    placeholder: 'sk-ant-…',
  },
  gemini: {
    url: 'https://aistudio.google.com/apikey',
    site: 'aistudio.google.com',
    label: 'Gemini API key',
    placeholder: 'Paste your Gemini key',
  },
};

/** Pick an AI and paste its key. `current` is the AI already connected, if any; then the user can also go back. */
export function ApiKeyScreen({ current, onClose }: { current: AiProvider | null; onClose: () => void }) {
  const [provider, setProvider] = useState<AiProvider>(current ?? 'anthropic');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (p: AiProvider) => {
    setProvider(p);
    setError(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await tidy().setApiKey(provider, key);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.error);
  };
  const where = KEYS[provider];
  return (
    <main className="welcome">
      <span className="icon-tile" aria-hidden>
        <KeyRound size={36} />
      </span>
      <h1>Connect Tidy to an AI</h1>
      <p className="lead">Tidy uses an AI to read your documents and answer your questions. Pick one, then paste your API key.</p>
      <div className="providers" role="radiogroup" aria-label="Which AI">
        {AI_PROVIDERS.map((p) => (
          <label key={p} className={`provider${p === provider ? ' on' : ''}`}>
            <input type="radio" name="provider" value={p} checked={p === provider} onChange={() => pick(p)} />
            <strong>{AI_NAMES[p].ai}</strong>
            <span>by {AI_NAMES[p].company}</span>
          </label>
        ))}
      </div>
      <p>
        Create a key at{' '}
        <a href={where.url} target="_blank" rel="noreferrer">
          {where.site}
        </a>{' '}
        and paste it here.
      </p>
      {provider === 'gemini' && (
        <p className="provider-note">
          Turn on billing for the key’s Google Cloud project first. On the free tier, Google can use what you send, including your tax
          documents, to improve its products.
        </p>
      )}
      <form className="key-form" onSubmit={submit}>
        <input
          aria-label={where.label}
          type="password"
          placeholder={where.placeholder}
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
      {current && (
        <button className="btn ghost" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden /> Keep using {AI_NAMES[current].ai}
        </button>
      )}
    </main>
  );
}
