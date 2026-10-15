import { useEffect, useState, type FormEvent } from 'react';
import { tidy } from '../api';

/** Same minimum as main (vault.ts MIN_PASSPHRASE), checked here first so the save dialog doesn't open in vain. */
const MIN_PASSPHRASE = 10;

/** Asks for the passphrase that locks (or opens) a backup file, then lets main ask where. */
export function BackupDialog({
  mode,
  onClose,
  onToast,
}: {
  mode: 'export' | 'restore';
  onClose: () => void;
  onToast: (text: string) => void;
}) {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exporting = mode === 'export';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (exporting && pass.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters.`);
    if (exporting && pass !== again) return setError('The two passphrases don’t match.');
    if (!pass) return setError('Enter the backup’s passphrase.');
    setError(null);
    setBusy(true);
    try {
      const r = exporting ? await tidy().exportBackup(pass) : await tidy().restoreBackup(pass);
      if (r.ok) {
        onToast('path' in r ? `Backup saved to ${r.path}` : 'Your return was restored from the backup.');
        onClose();
      } else if (r.error !== 'Cancelled.') setError(r.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="viewer-backdrop" role="dialog" aria-modal="true" aria-labelledby="backup-title" onClick={onClose}>
      <form className="backup-dialog" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void submit(e)}>
        <h2 id="backup-title">{exporting ? 'Back up your return' : 'Restore a backup'}</h2>
        <p className="help">
          {exporting
            ? 'Tidy saves your answers and documents in one file, locked with a passphrase you choose. Keep the passphrase somewhere safe: without it nobody can open the backup, not even you.'
            : 'Next, choose a .tidybackup file. It replaces the return in Tidy, and Tidy keeps a copy of the current one first.'}
        </p>
        <label>
          Passphrase
          <input
            type="password"
            autoFocus
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete={exporting ? 'new-password' : 'current-password'}
          />
        </label>
        {exporting && (
          <label>
            Type it again
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="backup-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {exporting ? 'Choose where to save' : 'Choose the backup file'}
          </button>
        </div>
      </form>
    </div>
  );
}
