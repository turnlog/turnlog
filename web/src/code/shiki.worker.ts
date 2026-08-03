/// <reference lib="webworker" />
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { SYNTAX_DARK, SYNTAX_LIGHT, toTextmate } from './syntax';

/**
 * Highlighting runs off the main thread; language grammars load lazily the
 * first time each language appears. The whitelist covers ~95% of real
 * sessions — anything else renders as plain text.
 */

const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
};

const turnlogDark = toTextmate('turnlog-dark', 'dark', SYNTAX_DARK);
const turnlogLight = toTextmate('turnlog-light', 'light', SYNTAX_LIGHT);

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [turnlogDark, turnlogLight],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighterPromise;
}

interface Job {
  id: number;
  code: string;
  lang: string;
  theme: 'dark' | 'light';
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, code, lang, theme } = e.data;
  try {
    const loader = LANG_LOADERS[lang];
    if (!loader) throw new Error(`language ${lang} not in whitelist`);
    const highlighter = await getHighlighter();
    if (!loadedLangs.has(lang)) {
      const mod = (await loader()) as { default: unknown };
      await highlighter.loadLanguage(mod.default as never);
      loadedLangs.add(lang);
    }
    const html = highlighter.codeToHtml(code, {
      lang,
      theme: theme === 'light' ? 'turnlog-light' : 'turnlog-dark',
    });
    self.postMessage({ id, html });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : 'highlight failed' });
  }
};
