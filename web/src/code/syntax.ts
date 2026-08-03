/**
 * The syntax palette, named once.
 *
 * It lives in TS rather than theme.css because its only consumer is a textmate
 * theme inside a web worker, which cannot read CSS custom properties — a worker
 * has no document. Keeping it here means one definition the worker builds from
 * and the design-system page renders from, instead of a hex table copied twice.
 */

export interface SyntaxPalette {
  foreground: string;
  comment: string;
  string: string;
  constant: string;
  keyword: string;
  function: string;
  type: string;
  variable: string;
  inserted: string;
  deleted: string;
  heading: string;
}

/* Every entry mirrors a theme.css token — the hex is repeated because a worker
   cannot read CSS variables. Change a token, change its twin here. */
export const SYNTAX_DARK: SyntaxPalette = {
  foreground: '#eceef2', // --tx0
  comment: '#626977', // --tx2
  string: '#5fd18d', // --success
  constant: '#f0a848', // --warning
  keyword: '#b6a7f5', // --c-command
  function: '#4fd6d6', // --c-diff
  type: '#f0663f', // --c-user (= --accent)
  variable: '#eceef2', // --tx0 — plain identifiers read as body code
  inserted: '#7fe0a5', // --success-tx
  deleted: '#ff8a94', // --danger-tx
  heading: '#f0663f', // --accent
};

export const SYNTAX_LIGHT: SyntaxPalette = {
  foreground: '#16181d', // --tx0
  comment: '#9aa0ab', // --tx2
  string: '#2a9760', // --success
  constant: '#7d4e05', // --warning
  keyword: '#6a51d8', // --c-command-tx
  function: '#12909e', // --c-diff
  type: '#e8542f', // --c-user (= --accent)
  variable: '#16181d', // --tx0
  inserted: '#1c7a4a', // --success-tx
  deleted: '#c02036', // --danger-tx
  heading: '#e8542f', // --accent
};

/** What each entry paints, for the design-system page. */
export const SYNTAX_USE: Record<keyof SyntaxPalette, string> = {
  foreground: 'plain code text · --tx0',
  comment: 'comments · --tx2',
  string: 'strings and templates · --success',
  constant: 'numbers, constants, escapes · --warning',
  keyword: 'keywords, storage, tags · --c-command',
  function: 'function names, attributes · --c-diff',
  type: 'types and classes · --c-user',
  variable: 'identifiers, punctuation, operators · --tx0',
  inserted: 'diff + lines · --success-tx',
  deleted: 'diff − lines · --danger-tx',
  heading: 'markdown headings · --accent',
};

/** Build a textmate theme from a palette. */
export function toTextmate(name: string, type: 'dark' | 'light', p: SyntaxPalette) {
  return {
    name,
    type,
    colors: { 'editor.background': '#00000000', 'editor.foreground': p.foreground },
    settings: [
      { settings: { foreground: p.foreground } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: p.comment, fontStyle: 'italic' },
      },
      { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: p.string } },
      {
        scope: ['constant.numeric', 'constant.language', 'constant.character.escape'],
        settings: { foreground: p.constant },
      },
      {
        scope: ['keyword', 'keyword.control', 'storage.type', 'storage.modifier'],
        settings: { foreground: p.keyword },
      },
      {
        scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
        settings: { foreground: p.function },
      },
      {
        scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
        settings: { foreground: p.type },
      },
      {
        scope: ['variable', 'variable.parameter', 'variable.other.property'],
        settings: { foreground: p.variable },
      },
      // Punctuation, operators and delimiters have no scope of their own in
      // most grammars, so they fall through to the theme default — pin them to
      // the foreground explicitly rather than relying on that.
      {
        scope: [
          'punctuation',
          'punctuation.definition',
          'punctuation.separator',
          'punctuation.terminator',
          'punctuation.section',
          'punctuation.accessor',
          'meta.brace',
          'meta.delimiter',
          'keyword.operator',
        ],
        settings: { foreground: p.foreground },
      },
      { scope: ['entity.name.tag'], settings: { foreground: p.keyword } },
      { scope: ['entity.other.attribute-name'], settings: { foreground: p.function } },
      { scope: ['markup.inserted'], settings: { foreground: p.inserted } },
      { scope: ['markup.deleted'], settings: { foreground: p.deleted } },
      { scope: ['markup.heading'], settings: { foreground: p.heading, fontStyle: 'bold' } },
    ],
  };
}
