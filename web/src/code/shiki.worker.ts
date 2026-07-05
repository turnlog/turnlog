/// <reference lib="webworker" />
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

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

/** Turnlog's palettes as textmate themes — match theme.css. */
const turnlogLight = {
  name: 'turnlog-light',
  type: 'light' as const,
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#212530',
  },
  settings: [
    { settings: { foreground: '#212530' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#8a92a0', fontStyle: 'italic' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#1d6b3d' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character.escape'], settings: { foreground: '#b06f10' } },
    { scope: ['keyword', 'keyword.control', 'storage.type', 'storage.modifier'], settings: { foreground: '#4a5f96' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: '#0f6e5f' } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: '#8a5606' } },
    { scope: ['variable.parameter', 'variable.other.property'], settings: { foreground: '#3c414d' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#4a5f96' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#0f6e5f' } },
    { scope: ['markup.inserted'], settings: { foreground: '#1d6b3d' } },
    { scope: ['markup.deleted'], settings: { foreground: '#a33325' } },
    { scope: ['markup.heading'], settings: { foreground: '#8a5606', fontStyle: 'bold' } },
  ],
};

const turnlogDark = {
  name: 'turnlog-dark',
  type: 'dark' as const,
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#e9e4d8',
  },
  settings: [
    { settings: { foreground: '#e9e4d8' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#67737d', fontStyle: 'italic' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#9fd8b4' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character.escape'], settings: { foreground: '#f0a848' } },
    { scope: ['keyword', 'keyword.control', 'storage.type', 'storage.modifier'], settings: { foreground: '#8f9ec4' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'], settings: { foreground: '#8fd0c3' } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: '#ffc46e' } },
    { scope: ['variable.parameter', 'variable.other.property'], settings: { foreground: '#d8d2c4' } },
    { scope: ['entity.name.tag'], settings: { foreground: '#8f9ec4' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#8fd0c3' } },
    { scope: ['markup.inserted'], settings: { foreground: '#9fd8b4' } },
    { scope: ['markup.deleted'], settings: { foreground: '#eba9a0' } },
    { scope: ['markup.heading'], settings: { foreground: '#ffc46e', fontStyle: 'bold' } },
  ],
};

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
