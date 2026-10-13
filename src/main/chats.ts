import { EventEmitter } from 'node:events';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { newestFirst } from '../core/chatSearch';
import type { Conversation } from '../shared/chat';
import { open, writeSealed } from './vault';

const CURRENT = 'current.bin';
const fileOf = (id: string) => `chat-${id}.bin`;

/** Saved chats, each in its own encrypted file, so a long chat never slows down saving the return. Like ReturnStore,
 *  writes run one at a time and each one is announced with a 'change' event. */
export class ChatStore extends EventEmitter {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly dir: string,
    private readonly key: Buffer,
    private readonly chats: Map<string, Conversation>,
    private current: string | null,
  ) {
    super();
  }

  /** Loads every chat. A file that can't be read is skipped and reported, so one bad file never stops Tidy starting. */
  static async open(dir: string, key: Buffer, onUnreadable: (file: string, e: unknown) => void = () => {}): Promise<ChatStore> {
    await mkdir(dir, { recursive: true });
    const read = async (file: string): Promise<unknown> => JSON.parse(open(key, await readFile(path.join(dir, file))).toString('utf8'));
    const chats = new Map<string, Conversation>();
    let current: string | null = null;
    for (const file of (await readdir(dir)).sort()) {
      try {
        if (file === CURRENT) current = ((await read(file)) as { id: string | null }).id;
        else if (file.startsWith('chat-') && file.endsWith('.bin')) {
          const c = (await read(file)) as Conversation;
          chats.set(c.id, c);
        }
      } catch (e) {
        onUnreadable(file, e);
      }
    }
    return new ChatStore(dir, key, chats, current !== null && chats.has(current) ? current : null);
  }

  /** The open chat; null means a new one that has no messages yet. */
  currentId(): string | null {
    return this.current;
  }

  get(id: string): Conversation | undefined {
    return this.chats.get(id);
  }

  /** Every chat, most recently used first. */
  all(): Conversation[] {
    return [...this.chats.values()].sort(newestFirst);
  }

  save(c: Conversation): Promise<void> {
    return this.queue(async () => {
      await writeSealed(path.join(this.dir, fileOf(c.id)), this.key, Buffer.from(JSON.stringify(c), 'utf8'));
      this.chats.set(c.id, c);
    });
  }

  setCurrent(id: string | null): Promise<void> {
    return this.queue(() => this.writeCurrent(id));
  }

  /** Deletes the chat's file for good. If it was open, the panel goes back to a new chat. */
  remove(id: string): Promise<void> {
    return this.queue(async () => {
      if (!this.chats.has(id)) return;
      await rm(path.join(this.dir, fileOf(id)), { force: true });
      this.chats.delete(id);
      if (this.current === id) await this.writeCurrent(null);
    });
  }

  private async writeCurrent(id: string | null): Promise<void> {
    await writeSealed(path.join(this.dir, CURRENT), this.key, Buffer.from(JSON.stringify({ id }), 'utf8'));
    this.current = id;
  }

  private queue(run: () => Promise<void>): Promise<void> {
    const step = async () => {
      await run();
      this.emit('change');
    };
    this.chain = this.chain.then(step, step);
    return this.chain;
  }
}
