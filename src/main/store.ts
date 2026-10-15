import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { emptyState, type AppState } from '../shared/state';
import { open, writeDurably, writeSealed } from './vault';

/** How often a copy of the saved return is kept, and how many copies. */
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUPS_KEPT = 20;

/** The single source of truth. All writes go through update(), which is serialized, persisted
 *  atomically and durably (temp file, flush, rename) and announced with a 'change' event. Every ten minutes of
 *  changes the previous save is kept in backups/ (the newest 20), and a save that can't be read falls back to the
 *  newest backup that can. */
export class ReturnStore extends EventEmitter {
  private chain: Promise<void> = Promise.resolve();
  private lastBackup = 0;
  private backupEveryMs = BACKUP_EVERY_MS;

  private constructor(
    private readonly dir: string,
    private readonly secret: Buffer,
    private state: AppState,
    private readonly nowIso: () => string,
    /** When the saved return couldn't be read: the backup it was restored from (its time). */
    readonly recoveredFrom: string | null,
  ) {
    super();
  }

  static async open(dir: string, secret: Buffer, nowIso: () => string, opts: { backupEveryMs?: number } = {}): Promise<ReturnStore> {
    const store = await ReturnStore.openState(dir, secret, nowIso);
    if (opts.backupEveryMs !== undefined) store.backupEveryMs = opts.backupEveryMs;
    return store;
  }

  private static async openState(dir: string, secret: Buffer, nowIso: () => string): Promise<ReturnStore> {
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    await mkdir(path.join(dir, 'backups'), { recursive: true });
    const read = async (file: string) => JSON.parse(open(secret, await readFile(file)).toString('utf8')) as AppState;
    try {
      return new ReturnStore(dir, secret, await read(path.join(dir, 'state.bin')), nowIso, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new ReturnStore(dir, secret, emptyState(nowIso()), nowIso, null);
      // Unreadable: keep it for later, and use the newest backup that opens.
      for (const name of await backupNames(dir)) {
        try {
          const state = await read(path.join(dir, 'backups', name));
          await rename(path.join(dir, 'state.bin'), path.join(dir, `state-unreadable-${Date.now()}.bin`));
          await copyFile(path.join(dir, 'backups', name), path.join(dir, 'state.bin'));
          return new ReturnStore(dir, secret, state, nowIso, backupTime(name));
        } catch {
          // try the next one
        }
      }
      throw e;
    }
  }

  get(): AppState {
    return this.state;
  }

  /** Mutate a draft copy; the store swaps it in, saves it, then emits 'change'. */
  update(mutate: (draft: AppState) => void): Promise<void> {
    const run = async () => {
      const draft = structuredClone(this.state);
      mutate(draft);
      await this.keepBackup();
      await this.write('state.bin', Buffer.from(JSON.stringify(draft), 'utf8'));
      this.state = draft;
      this.emit('change', this.state);
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  /** Swaps in a whole return (a restored backup): its documents first, then the state, then drops documents the new
   *  state doesn't use. The current return is kept as a backup first. */
  replaceAll(state: AppState, documents: ReadonlyMap<string, Buffer>): Promise<void> {
    const run = async () => {
      this.lastBackup = 0;
      await this.keepBackup();
      for (const [id, bytes] of documents) await this.putDocument(id, bytes);
      await this.write('state.bin', Buffer.from(JSON.stringify(state), 'utf8'));
      const keep = new Set(state.documents.map((d) => `${d.id}.bin`));
      for (const name of await readdir(path.join(this.dir, 'docs')))
        if (!keep.has(name)) await rm(path.join(this.dir, 'docs', name), { force: true });
      this.state = state;
      this.emit('change', this.state);
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  putDocument(id: string, bytes: Buffer): Promise<void> {
    return this.write(path.join('docs', `${id}.bin`), bytes);
  }

  async getDocument(id: string): Promise<Buffer> {
    return open(this.secret, await readFile(path.join(this.dir, 'docs', `${id}.bin`)));
  }

  /** Removing a document deletes its file right away, so a backup restored later can't show its pages. */
  deleteDocument(id: string): Promise<void> {
    return rm(path.join(this.dir, 'docs', `${id}.bin`), { force: true });
  }

  private async keepBackup(): Promise<void> {
    const now = Date.now();
    if (this.lastBackup > 0 && now - this.lastBackup < this.backupEveryMs) return;
    try {
      const sealed = await readFile(path.join(this.dir, 'state.bin'));
      await writeDurably(path.join(this.dir, 'backups', `state-${this.nowIso().replace(/[:.]/g, '-')}.bin`), sealed);
      this.lastBackup = now;
      for (const old of (await backupNames(this.dir)).slice(BACKUPS_KEPT)) await rm(path.join(this.dir, 'backups', old), { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // nothing saved yet
    }
  }

  private write(rel: string, plain: Buffer): Promise<void> {
    return writeSealed(path.join(this.dir, rel), this.secret, plain);
  }
}

/** Backup file names, newest first. */
async function backupNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(dir, 'backups')))
      .filter((n) => /^state-.*\.bin$/.test(n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** "state-2026-10-15T12-00-00-000Z.bin" → "2026-10-15T12:00:00.000Z". */
const backupTime = (name: string) =>
  name
    .replace(/^state-/, '')
    .replace(/\.bin$/, '')
    .replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z');
