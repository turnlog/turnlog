import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

/**
 * Docs ↔ code drift guards.
 *
 * `docs/` is generated against the source, not written from memory, and the
 * only thing keeping that true is this file. Every check is a SET EQUALITY in
 * both directions, so it fails on a new undocumented operator AND on a
 * documented one that no longer exists — a one-way "everything is documented"
 * check silently rots as things are removed.
 */

/**
 * Line endings are normalized because the repo has no `.gitattributes`, so
 * Windows checks these files out with CRLF — and a frontmatter check anchored
 * on `\n` then fails on every page at once. That failure only ever appears on
 * the CI matrix's Windows leg, never locally.
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const DOCS = path.join(ROOT, 'docs');

/** Every .md under docs/, as nav-style paths ("product/getting-started"). */
function docPages(dir = DOCS, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) return docPages(path.join(dir, e.name), rel);
    return e.name.endsWith('.md') && e.name !== 'README.md' ? [rel.replace(/\.md$/, '')] : [];
  });
}

function navPages(): string[] {
  const cfg = JSON.parse(read('docs/docs.json')) as {
    navigation: { tabs: { groups: { pages: string[] }[] }[] };
  };
  return cfg.navigation.tabs.flatMap((t) => t.groups.flatMap((g) => g.pages));
}

describe('docs ↔ code drift', () => {
  it('documents exactly the search operators the parser accepts', () => {
    const src = /const FILTER_OPS = new Set\(\[([\s\S]*?)\]\);/.exec(read('src/server/api.ts'))![1]!;
    const code = new Set([...src.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!));
    // Bare `op:` in backticks — `tool:Bash` in an example has text after the
    // colon and is deliberately not counted.
    const docs = new Set(
      [...read('docs/reference/search-operators.md').matchAll(/`([a-z]+):`/g)].map((m) => m[1]!),
    );
    expect(docs).toEqual(code);
  });

  it('teaches the agent skill every operator the parser accepts', () => {
    const src = /const FILTER_OPS = new Set\(\[([\s\S]*?)\]\);/.exec(read('src/server/api.ts'))![1]!;
    const code = [...src.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
    // An operator the skill does not name is one the agent never uses — the
    // grammar block is the only place it learns them.
    const skill = read('src/mcp/skill.ts');
    expect(code.filter((op) => !skill.includes(`${op}:`))).toEqual([]);
  });

  it('documents exactly the CLI commands and flags', () => {
    const cli = read('src/cli/index.ts');
    const doc = read('docs/reference/cli.md');

    const commands = new Set(
      [...cli.matchAll(/^    case '([a-z]+)':/gm)].map((m) => m[1]!).filter((c) => c !== 'start'),
    );
    const documented = new Set(
      [...doc.matchAll(/`turnlog ([a-z]+)/g)].map((m) => m[1]!).filter((c) => commands.has(c)),
    );
    expect(documented).toEqual(commands);

    const parsed = /options: \{([\s\S]*?)\n      \},/.exec(cli)![1]!;
    const flags = new Set([...parsed.matchAll(/^\s+'?([a-z-]+)'?: \{ type:/gm)].map((m) => m[1]!));
    // Must start with a letter, or frontmatter's `---` reads as a flag named "-".
    const docFlags = new Set([...doc.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]!));
    expect([...flags].filter((f) => !docFlags.has(f))).toEqual([]);
    expect([...docFlags].filter((f) => !flags.has(f))).toEqual([]);
  });

  it('documents exactly the settings.json keys', () => {
    const iface = /export interface Settings \{([\s\S]*?)\n\}/.exec(read('src/config.ts'))![1]!;
    const code = new Set([...iface.matchAll(/^\s{2}([a-zA-Z]+)\?:/gm)].map((m) => m[1]!));
    const docs = new Set(
      [...read('docs/reference/settings.md').matchAll(/^## `([a-zA-Z]+)`/gm)].map((m) => m[1]!),
    );
    expect(docs).toEqual(code);
  });

  it('documents exactly the MCP tools', () => {
    const code = new Set(
      [...read('src/mcp/mcp.ts').matchAll(/^    name: '([a-z_]+)',$/gm)].map((m) => m[1]!),
    );
    const docs = new Set(
      [...read('docs/reference/mcp-tools.md').matchAll(/^## `([a-z_]+)`/gm)].map((m) => m[1]!),
    );
    expect(docs).toEqual(code);
  });
});

describe('docs site structure', () => {
  it('has a file for every nav entry and a nav entry for every file', () => {
    const nav = navPages();
    expect(new Set(nav)).toEqual(new Set(docPages()));
    // Mintlify does not auto-discover, so a duplicate would silently shadow.
    expect(nav.length).toBe(new Set(nav).size);
  });

  it('has no dead internal links', () => {
    const pages = new Set(docPages());
    const dead: string[] = [];
    for (const page of docPages()) {
      for (const m of read(`docs/${page}.md`).matchAll(/\]\((\/docs\/[^)#]+)(#[^)]*)?\)/g)) {
        const target = m[1]!.replace('/docs/', '').replace(/\/$/, '');
        if (!pages.has(target)) dead.push(`${page} -> ${m[1]!}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('gives every page frontmatter with a title and description', () => {
    const bad = docPages().filter((p) => {
      const head = read(`docs/${p}.md`).slice(0, 400);
      return !head.startsWith('---\n') || !/\ntitle: /.test(head) || !/\ndescription: /.test(head);
    });
    expect(bad).toEqual([]);
  });

  it('ships assets docs.json points at, and keeps them valid XML', () => {
    const cfg = JSON.parse(read('docs/docs.json')) as {
      logo: { light: string; dark: string };
      favicon: string;
    };
    for (const rel of [cfg.logo.light, cfg.logo.dark, cfg.favicon]) {
      const file = path.join(DOCS, rel.replace(/^\//, ''));
      expect(fs.existsSync(file), `${rel} is referenced but missing`).toBe(true);
      // An XML comment may not contain two hyphens in a row. A file that breaks
      // this parses as nothing and the browser silently keeps the old asset —
      // which is exactly how the first favicon shipped broken.
      const body = fs.readFileSync(file, 'utf8');
      for (const c of body.matchAll(/<!--([\s\S]*?)-->/g)) {
        expect(c[1]!.includes('--'), `${rel} has "--" inside an XML comment`).toBe(false);
      }
    }
  });

  it('keeps docs out of the npm tarball', () => {
    const pkg = JSON.parse(read('package.json')) as { files: string[] };
    expect(pkg.files.some((f) => f.startsWith('docs'))).toBe(false);
  });
});
