import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatStore } from '../../src/main/chats';
import type { Conversation } from '../../src/shared/chat';

const conv = (id: string, at: string): Conversation => ({
  id,
  title: `Hello ${id}`,
  createdAt: at,
  updatedAt: at,
  messages: [{ id: `m-${id}`, role: 'user', text: `Hello ${id}`, at, proposalIds: [] }],
  transcript: [{ role: 'user', parts: [{ text: `Hello ${id}` }] }],
  transcriptBy: 'gemini',
});

async function twoChats() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tidy-chats-'));
  const key = randomBytes(32);
  const chats = await ChatStore.open(dir, key);
  let changes = 0;
  chats.on('change', () => changes++);
  await chats.save(conv('a', '2026-10-01T16:00:00.000Z'));
  await chats.save(conv('b', '2026-10-02T16:00:00.000Z'));
  await chats.setCurrent('a');
  return { dir, key, chats, changes: () => changes };
}

describe('ChatStore', () => {
  it('keeps every chat and the open one across restarts, encrypted on disk', async () => {
    const { dir, key, changes } = await twoChats();
    expect(changes()).toBe(3);
    const again = await ChatStore.open(dir, key);
    expect(again.all().map((c) => c.id)).toEqual(['b', 'a']);
    expect(again.currentId()).toBe('a');
    expect(again.get('a')).toEqual(conv('a', '2026-10-01T16:00:00.000Z'));
    expect((await readFile(path.join(dir, 'chat-a.bin'))).includes(Buffer.from('Hello a'))).toBe(false);
  });

  it('deletes a chat for good, and closes it if it was open', async () => {
    const { dir, key, chats } = await twoChats();
    await chats.remove('a');
    expect(chats.get('a')).toBeUndefined();
    expect(chats.currentId()).toBeNull();
    expect((await readdir(dir)).sort()).toEqual(['chat-b.bin', 'current.bin']);
    const again = await ChatStore.open(dir, key);
    expect(again.all().map((c) => c.id)).toEqual(['b']);
    expect(again.currentId()).toBeNull();
  });

  it('skips a chat file it can’t read instead of failing to start', async () => {
    const { dir, key } = await twoChats();
    await writeFile(path.join(dir, 'chat-broken.bin'), 'not a vault file');
    const unreadable: string[] = [];
    const again = await ChatStore.open(dir, key, (file) => unreadable.push(file));
    expect(again.all().map((c) => c.id)).toEqual(['b', 'a']);
    expect(unreadable).toEqual(['chat-broken.bin']);
  });
});
