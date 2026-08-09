import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const THEME = path.join(ROOT, 'web/src/theme.css');

/** Declaration blocks, each stripped of comments, keyed by their selector. */
function blocks(css: string): { selector: string; body: string }[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    out.push({ selector: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! });
  }
  return out;
}

describe('design tokens', () => {
  /**
   * The bug this exists for: `--rail-w` is the replay's 3px speaker rail, and
   * a second `--rail-w: 68px` was added to the same `:root` for the collapsed
   * sidebar. The later one wins, so every speaker rail became a 68px border
   * and the bookmark toggle lost its gutter. Nothing failed — it only looked
   * wrong, on a screen neither change was about.
   *
   * Redeclaring a token across theme blocks is the whole point, so this is
   * scoped to duplicates WITHIN one block.
   */
  it('never declares the same custom property twice in one block', () => {
    const css = fs.readFileSync(THEME, 'utf8');
    const clashes: string[] = [];
    for (const { selector, body } of blocks(css)) {
      const seen = new Set<string>();
      for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
        const name = m[1]!;
        if (seen.has(name)) clashes.push(`${selector} declares ${name} twice`);
        seen.add(name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('defines every token the light theme overrides', () => {
    const css = fs.readFileSync(THEME, 'utf8');
    const found = blocks(css);
    const names = (sel: string) =>
      new Set(
        found
          .filter((b) => b.selector.includes(sel))
          .flatMap((b) => [...b.body.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!)),
      );
    const dark = names(':root');
    const light = names("data-theme='light'");
    // A light-only token has no dark value to fall back to.
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
  });
});
