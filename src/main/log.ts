import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

/** Anything shaped like an API key or token is hidden before it reaches the log. */
const SECRETS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[hidden]'],
  [/AIza[0-9A-Za-z_-]{10,}/g, 'AIza[hidden]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [hidden]'],
];
const STACK_LINES = 8;
const MAX_ENTRY = 4_000;

/** One log entry: when, where it happened, the error and the top of its stack. */
export function errorText(where: string, e: unknown, nowIso: string): string {
  let body: string;
  if (e instanceof Error) {
    const kind = e.constructor.name && e.constructor.name !== 'Error' ? e.constructor.name : e.name;
    const stack = (e.stack ?? '')
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('at '))
      .slice(0, STACK_LINES);
    body = [`${kind}: ${e.message}`, ...stack.map((l) => `    ${l}`)].join('\n');
  } else {
    body = typeof e === 'string' ? e : (JSON.stringify(e) ?? String(e));
  }
  const text = SECRETS.reduce((t, [pattern, mask]) => t.replace(pattern, mask), `[${nowIso}] ${where}: ${body}`);
  return text.length > MAX_ENTRY ? `${text.slice(0, MAX_ENTRY)}…` : text;
}

/** Appends entries to the file, keeping one older file once it passes `maxBytes`. Logging never throws. */
export function fileLog(file: () => string, now: () => string, maxBytes = 1_000_000): (where: string, e: unknown) => void {
  return (where, e) => {
    try {
      const target = file();
      mkdirSync(path.dirname(target), { recursive: true });
      try {
        if (statSync(target).size > maxBytes) renameSync(target, target.replace(/\.log$/, '.old.log'));
      } catch {
        // no log yet
      }
      appendFileSync(target, `${errorText(where, e, now())}\n`);
    } catch {
      // a log that can't be written must not become the next error
    }
  };
}
