import type { Override } from '../shared/state';

type Json = Record<string, unknown> | unknown[];

/** Apply overrides in order. Path segments address object keys, or array items by their `id` field.
 *  Returns a NEW object; never mutates the input. Unknown paths throw (callers drop stale overrides). */
export function applyOverrides<T extends object>(base: T, overrides: readonly Override[]): T {
  const out = structuredClone(base) as T;
  for (const o of overrides) setPath(out as unknown as Json, o.path, o.value);
  return out;
}

function setPath(root: Json, path: readonly string[], value: unknown): void {
  if (path.length === 0) throw new Error('override path is empty');
  let node: Json = root;
  for (let i = 0; i < path.length - 1; i++) node = child(node, path[i], path);
  const last = path[path.length - 1];
  if (Array.isArray(node)) {
    const idx = node.findIndex((x) => (x as { id?: string }).id === last);
    if (idx < 0) throw new Error(`override path not found: ${path.join('/')}`);
    node[idx] = value;
  } else {
    if (!(last in node)) throw new Error(`override path not found: ${path.join('/')}`);
    node[last] = value;
  }
}

function child(node: Json, key: string, path: readonly string[]): Json {
  const next = Array.isArray(node) ? node.find((x) => (x as { id?: string }).id === key) : (node as Record<string, unknown>)[key];
  if (next === null || typeof next !== 'object') throw new Error(`override path not found: ${path.join('/')}`);
  return next as Json;
}
