import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MIN_PASSPHRASE, openWithPassphrase, sealWithPassphrase, WrongPassphraseError } from '../../src/main/vault';
import { ReturnStore } from '../../src/main/store';
import { trustedFrame } from '../../src/main/trust';

const PASS = 'correct horse battery';
let tick = 0;
/** A clock that moves a second per call, so each backup gets its own name. */
const clock = () => new Date(Date.UTC(2026, 9, 15, 12, 0, tick++)).toISOString();
const tempDir = () => mkdtemp(path.join(tmpdir(), 'tidy-backup-'));

describe('passphrase backups', () => {
  it('open only with the passphrase that locked them', async () => {
    const sealed = await sealWithPassphrase(PASS, Buffer.from('SSN 400-00-0001'));
    expect(sealed.includes(Buffer.from('400-00-0001'))).toBe(false);
    expect((await openWithPassphrase(PASS, sealed)).toString()).toBe('SSN 400-00-0001');
    await expect(openWithPassphrase('wrong passphrase!', sealed)).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(openWithPassphrase(PASS, Buffer.from('%PDF-1.7'))).rejects.toThrow('isn’t a Tidy backup');
    await expect(sealWithPassphrase('short', Buffer.from('x'))).rejects.toThrow(`${MIN_PASSPHRASE} characters`);
  });
});

describe('ReturnStore backups', () => {
  it('keeps earlier saves, and opens the newest readable one when the save is damaged', async () => {
    const dir = await tempDir();
    const secret = randomBytes(32);
    const store = await ReturnStore.open(dir, secret, clock, { backupEveryMs: 0 });
    for (const n of [1, 2, 3]) {
      await store.update((d) => {
        d.createdAt = `save ${n}`;
      });
    }
    // Each save first kept the one before it (the first save had nothing to keep).
    expect((await readdir(path.join(dir, 'backups'))).filter((n) => n.startsWith('state-'))).toHaveLength(2);

    const statePath = path.join(dir, 'state.bin');
    const damaged = await readFile(statePath);
    damaged[damaged.length - 1] ^= 1;
    await writeFile(statePath, damaged);
    const reopened = await ReturnStore.open(dir, secret, clock);
    expect(reopened.get().createdAt).toBe('save 2');
    expect(reopened.recoveredFrom).toMatch(/^2026-10-15T12:00:\d\d\.000Z$/);
    expect((await readdir(dir)).some((n) => n.startsWith('state-unreadable-'))).toBe(true);
  });

  it('still fails loudly when nothing can be read', async () => {
    const dir = await tempDir();
    await ReturnStore.open(dir, randomBytes(32), clock).then((s) => s.update(() => undefined));
    await expect(ReturnStore.open(dir, randomBytes(32), clock)).rejects.toThrow();
  });

  it('keeps the newest 20', async () => {
    const dir = await tempDir();
    const store = await ReturnStore.open(dir, randomBytes(32), clock, { backupEveryMs: 0 });
    for (let i = 0; i < 25; i++) await store.update(() => undefined);
    expect((await readdir(path.join(dir, 'backups'))).filter((n) => n.startsWith('state-'))).toHaveLength(20);
  });

  it('swaps in a restored return, keeping the current one as a backup and dropping unused documents', async () => {
    const dir = await tempDir();
    const store = await ReturnStore.open(dir, randomBytes(32), clock);
    await store.putDocument('old', Buffer.from('old doc'));
    const restored = { ...store.get(), createdAt: 'restored', documents: [{ id: 'new' } as never] };
    await store.replaceAll(restored, new Map([['new', Buffer.from('new doc')]]));
    expect(store.get().createdAt).toBe('restored');
    expect((await store.getDocument('new')).toString()).toBe('new doc');
    expect(await readdir(path.join(dir, 'docs'))).toEqual(['new.bin']);
  });
});

describe('trusted frames', () => {
  const file = 'file:///Applications/Tidy.app/Contents/Resources/app.asar/out/renderer/index.html';
  it('accept only Tidy’s own page', () => {
    expect(trustedFrame(file, undefined, file)).toBe(true);
    expect(trustedFrame(`${file}#/documents`, undefined, file)).toBe(true);
    expect(trustedFrame('file:///tmp/evil/renderer/index.html', undefined, file)).toBe(false);
    expect(trustedFrame(`${file}.evil.html`, undefined, file)).toBe(false);
    expect(trustedFrame(undefined, undefined, file)).toBe(false);
    expect(trustedFrame('http://localhost:5173/', 'http://localhost:5173', file)).toBe(true);
    expect(trustedFrame('http://localhost:5174/', 'http://localhost:5173', file)).toBe(false);
  });
});
