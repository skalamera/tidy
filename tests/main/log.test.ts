import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorText, fileLog } from '../../src/main/log';

const NOW = '2026-10-13T12:00:00.000Z';

describe('the error log', () => {
  it('records when, where and what went wrong, with the stack, and never an API key', () => {
    const e = new TypeError(`bad sk-ant-api03-${'a'.repeat(24)} and AIza${'b'.repeat(35)} and Bearer ${'c'.repeat(24)}`);
    const lines = errorText('Chat', e, NOW).split('\n');
    expect(lines[0]).toBe('[2026-10-13T12:00:00.000Z] Chat: TypeError: bad sk-ant-[hidden] and AIza[hidden] and Bearer [hidden]');
    expect(lines[1]).toMatch(/^ {4}at /);
    expect(lines.join('\n')).not.toMatch(/a{24}|b{35}|c{24}/);
  });

  it('records things thrown that aren’t errors', () => {
    expect(errorText('Screen', 'Something broke', NOW)).toBe('[2026-10-13T12:00:00.000Z] Screen: Something broke');
  });

  it('appends to a file, and starts a fresh one once it gets big', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tidy-log-'));
    const log = fileLog(
      () => path.join(dir, 'logs', 'tidy.log'),
      () => NOW,
      400,
    );
    log('First', new Error('one'));
    expect(await readFile(path.join(dir, 'logs', 'tidy.log'), 'utf8')).toMatch(/^\[2026-10-13T12:00:00.000Z\] First: Error: one\n/);
    for (let i = 0; i < 5; i++) log('Again', new Error(`number ${i}`));
    expect((await readdir(path.join(dir, 'logs'))).sort()).toEqual(['tidy.log', 'tidy.old.log']);
    expect(await readFile(path.join(dir, 'logs', 'tidy.log'), 'utf8')).toContain('number 4');
  });
});
