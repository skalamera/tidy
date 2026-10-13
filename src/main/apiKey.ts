import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AI_PROVIDERS, type AiProvider } from '../shared/ai';
import type { SafeStorageLike } from './vault';

async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** One API key per AI, each encrypted with the macOS Keychain (safeStorage), plus which AI is in use.
 *  Keys are never logged and never sent to the renderer. */
export class AiKeyStore {
  constructor(
    private readonly dir: string,
    private readonly safe: SafeStorageLike,
  ) {}

  private keyFile = (p: AiProvider) => path.join(this.dir, `${p}-key.bin`);
  private readonly choiceFile = () => path.join(this.dir, 'ai-provider.txt');

  /** The AI in use and its key, or null before the first key is saved. Claude was the only choice before Gemini. */
  async load(): Promise<{ provider: AiProvider; key: string } | null> {
    const choice = (await readIfExists(this.choiceFile()))?.toString('utf8').trim();
    const provider = AI_PROVIDERS.find((p) => p === choice) ?? 'anthropic';
    const encrypted = await readIfExists(this.keyFile(provider));
    return encrypted ? { provider, key: this.safe.decryptString(encrypted) } : null;
  }

  async save(provider: AiProvider, key: string): Promise<void> {
    await writeFile(this.keyFile(provider), this.safe.encryptString(key));
    await writeFile(this.choiceFile(), provider);
  }
}

/** Cheap check before the network check, with a hint when the key belongs to the other AI. Google issues
 *  "AIza…" keys and newer auth keys whose format isn't published, so a Gemini key only has to look like a token. */
export function keyProblem(provider: AiProvider, key: string): string | null {
  if (provider === 'anthropic') {
    if (/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return null;
    if (key.startsWith('AIza')) return 'That looks like a Gemini key. Pick Gemini above, or paste a Claude key.';
    return 'That doesn’t look like an Anthropic key. It starts with “sk-ant-”.';
  }
  if (key.startsWith('sk-ant-')) return 'That looks like a Claude key. Pick Claude above, or paste a Gemini key.';
  if (!/^\S{20,}$/.test(key)) return 'That doesn’t look like a Gemini key. Copy the whole key from Google AI Studio and paste it again.';
  return null;
}
