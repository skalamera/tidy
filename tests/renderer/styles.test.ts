import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/src/styles.css', 'utf8');

/** Every innermost rule as [selector, body], comments removed. Enough for this flat stylesheet. */
function rules(src: string): [string, string][] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

describe('styles', () => {
  // The rise keyframes animate transform, and an animated transform replaces the one an element uses to position
  // itself: the toast slid in off-centre for 0.2 s, then jumped to the middle.
  it('positions nothing that rises in with transform', () => {
    const clashing = rules(css)
      .filter(([, body]) => /animation:\s*rise\b/.test(body) && /(^|[;\s])transform\s*:/.test(body))
      .map(([selector]) => selector);
    expect(clashing).toEqual([]);
  });
});
