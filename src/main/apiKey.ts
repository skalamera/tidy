import { readFile, writeFile, rm } from 'node:fs/promises';
import type { SafeStorageLike } from './vault';

/** The Anthropic API key, encrypted with the macOS Keychain (safeStorage). Never logged, never sent to the renderer. */
export class ApiKeyStore {
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
  ) {}

  async load(): Promise<string | null> {
    try {
      return this.safe.decryptString(await readFile(this.file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async save(key: string): Promise<void> {
    await writeFile(this.file, this.safe.encryptString(key));
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}

/** Anthropic keys look like "sk-ant-...". Cheap format check before the network check. */
export const looksLikeApiKey = (key: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
