import { describe, expect, it } from 'vitest';
import { localDay, markPattern, searchChats } from '../../src/core/chatSearch';
import { chatTitle, type ChatMessage, type Conversation } from '../../src/shared/chat';

// Midday UTC, so each message lands on the same calendar day in any US time zone.
const msg = (text: string, at: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({
  id: `${at}-${role}`,
  role,
  text,
  at,
  proposalIds: [],
});
const chat = (id: string, messages: ChatMessage[]): Conversation => ({
  id,
  title: chatTitle(messages[0].text),
  createdAt: messages[0].at,
  updatedAt: messages[messages.length - 1].at,
  messages,
  transcript: [],
  transcriptBy: 'gemini',
});

const salt = chat('salt', [
  msg('How does the SALT cap work?', '2026-10-01T16:00:00.000Z'),
  msg('For 2025 the cap on state and local taxes is $40,000 (2025 Schedule A instructions).', '2026-10-01T16:00:05.000Z', 'assistant'),
]);
const box12 = chat('box12', [
  msg('What is box 12 on my W-2?', '2026-10-05T16:00:00.000Z'),
  msg('Code D in box 12 is what you put into a 401(k).', '2026-10-05T16:00:05.000Z', 'assistant'),
]);
const refund = chat('refund', [
  msg('Why don’t I get a bigger refund?', '2026-10-08T16:00:00.000Z'),
  msg('Your withholding was lower this year.', '2026-10-08T16:00:05.000Z', 'assistant'),
  msg('Does the SALT cap matter here?', '2026-10-12T16:00:00.000Z'),
]);
const ALL = [salt, box12, refund];
const ids = (words: string, from: string | null = null, to: string | null = null) => searchChats(ALL, { words, from, to }).map((h) => h.id);

describe('searchChats', () => {
  it('with nothing to search for, lists every chat, newest first', () => {
    expect(searchChats(ALL, { words: '', from: null, to: null })).toEqual([
      { id: 'refund', snippet: null },
      { id: 'box12', snippet: null },
      { id: 'salt', snippet: null },
    ]);
  });

  it('finds chats that hold every word, in any case, with straight quotes matching curly ones', () => {
    expect(ids('salt cap')).toEqual(['refund', 'salt']);
    expect(ids('SALT 401(k)')).toEqual([]);
    expect(ids('box 12 w-2')).toEqual(['box12']);
    expect(ids("don't")).toEqual(['refund']);
    expect(ids('withholding')).toEqual(['refund']);
  });

  it('needs a word of one or two characters to stand alone, so "D" doesn’t match "does" and "12" doesn’t match "2012"', () => {
    expect(ids('d')).toEqual(['box12']);
    expect(ids('code d')).toEqual(['box12']);
    expect(ids('12')).toEqual(['box12']);
    expect(ids('202')).toEqual(['salt']); // three characters or more can be part of a word, like "2025"
  });

  it('marks the searched words in a passage by the same rules', () => {
    expect('What does code D mean? Don’t ask.'.split(markPattern("code d don't")!)).toEqual([
      'What does ',
      'code',
      ' ',
      'D',
      ' mean? ',
      'Don’t',
      ' ask.',
    ]);
    expect(markPattern('  ')).toBeNull();
  });

  it('with dates, keeps chats with a message on those days, and the words must be in those messages', () => {
    expect(ids('', '2026-10-05', '2026-10-08')).toEqual(['refund', 'box12']);
    expect(ids('', '2026-10-10', null)).toEqual(['refund']);
    expect(ids('', null, '2026-10-01')).toEqual(['salt']);
    expect(ids('salt', null, '2026-10-09')).toEqual(['salt']);
    expect(ids('salt', '2026-10-09', null)).toEqual(['refund']);
    expect(ids('', '2026-10-13', null)).toEqual([]);
  });

  it('shows where the words were found, cut to whole words', () => {
    const long = chat('long', [
      msg(
        `${'Some background first. '.repeat(6)}The SALT cap limits what you can deduct for state and local taxes. ${'More after that. '.repeat(8)}`,
        '2026-10-02T16:00:00.000Z',
      ),
    ]);
    const [hit] = searchChats([long], { words: 'deduct', from: null, to: null });
    expect(hit.snippet).toMatch(/^…\S/);
    expect(hit.snippet).toMatch(/\S…$/);
    expect(hit.snippet).toContain('The SALT cap limits what you can deduct for state and local taxes.');
    expect(searchChats([salt], { words: 'cap', from: null, to: null })[0].snippet).toBe('How does the SALT cap work?');
  });

  it('reads days on this computer’s clock', () => {
    expect(localDay('2026-10-13T16:00:00.000Z')).toBe('2026-10-13');
  });

  it('names a chat after its first question, on one line', () => {
    expect(chatTitle('  How does\nthe SALT cap work?  ')).toBe('How does the SALT cap work?');
    expect(chatTitle('a '.repeat(60))).toBe(`${'a '.repeat(28)}a…`);
  });
});
