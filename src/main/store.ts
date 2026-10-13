import { mkdir, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { emptyState, type AppState } from '../shared/state';
import { open, writeSealed } from './vault';

/** The single source of truth. All writes go through update(), which is serialized, persisted
 *  atomically (write temp file, then rename) and announced with a 'change' event. */
export class ReturnStore extends EventEmitter {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly dir: string,
    private readonly key: Buffer,
    private state: AppState,
  ) {
    super();
  }

  static async open(dir: string, key: Buffer, nowIso: () => string): Promise<ReturnStore> {
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    let state: AppState;
    try {
      state = JSON.parse(open(key, await readFile(path.join(dir, 'state.bin'))).toString('utf8')) as AppState;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      state = emptyState(nowIso());
    }
    return new ReturnStore(dir, key, state);
  }

  get(): AppState {
    return this.state;
  }

  /** Mutate a draft copy; the store swaps it in, saves it, then emits 'change'. */
  update(mutate: (draft: AppState) => void): Promise<void> {
    const run = async () => {
      const draft = structuredClone(this.state);
      mutate(draft);
      await this.write('state.bin', Buffer.from(JSON.stringify(draft), 'utf8'));
      this.state = draft;
      this.emit('change', this.state);
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  putDocument(id: string, bytes: Buffer): Promise<void> {
    return this.write(path.join('docs', `${id}.bin`), bytes);
  }

  async getDocument(id: string): Promise<Buffer> {
    return open(this.key, await readFile(path.join(this.dir, 'docs', `${id}.bin`)));
  }

  deleteDocument(id: string): Promise<void> {
    return rm(path.join(this.dir, 'docs', `${id}.bin`), { force: true });
  }

  private write(rel: string, plain: Buffer): Promise<void> {
    return writeSealed(path.join(this.dir, rel), this.key, plain);
  }
}
