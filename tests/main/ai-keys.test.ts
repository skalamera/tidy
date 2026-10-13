import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AiKeyStore, keyProblem } from '../../src/main/apiKey';

/** Stands in for Electron safeStorage: reversible, and the plain key never reaches the disk. */
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'base64').toString(),
};
const CLAUDE_KEY = `sk-ant-${'a'.repeat(30)}`;
const GEMINI_KEY = `AIza${'g'.repeat(35)}`;

describe('AiKeyStore', () => {
  it('remembers which AI was picked, each with its own encrypted key', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tidy-keys-'));
    const keys = new AiKeyStore(dir, safe);
    expect(await keys.load()).toBeNull();
    await keys.save('anthropic', CLAUDE_KEY);
    await keys.save('gemini', GEMINI_KEY);
    expect(await keys.load()).toEqual({ provider: 'gemini', key: GEMINI_KEY });
    expect((await readFile(path.join(dir, 'gemini-key.bin'))).toString()).not.toContain(GEMINI_KEY);
    await keys.save('anthropic', CLAUDE_KEY);
    expect(await keys.load()).toEqual({ provider: 'anthropic', key: CLAUDE_KEY });
  });

  it('still reads a Claude key saved before Gemini support', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tidy-keys-'));
    await writeFile(path.join(dir, 'anthropic-key.bin'), safe.encryptString(CLAUDE_KEY));
    expect(await new AiKeyStore(dir, safe).load()).toEqual({ provider: 'anthropic', key: CLAUDE_KEY });
  });
});

describe('keyProblem', () => {
  it('accepts each AI’s key and explains a key pasted under the wrong AI', () => {
    expect(keyProblem('anthropic', CLAUDE_KEY)).toBeNull();
    expect(keyProblem('gemini', GEMINI_KEY)).toBeNull();
    expect(keyProblem('gemini', 'x'.repeat(40))).toBeNull(); // Google also issues newer auth keys; their format isn't published
    expect(keyProblem('anthropic', GEMINI_KEY)).toContain('Gemini key');
    expect(keyProblem('gemini', CLAUDE_KEY)).toContain('Claude key');
    expect(keyProblem('anthropic', 'hello')).toContain('sk-ant-');
    expect(keyProblem('gemini', 'hello')).toContain('Gemini key');
  });
});
