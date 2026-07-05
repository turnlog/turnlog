/** Main-thread client for the Shiki worker: request/response + LRU cache. */

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  python: 'python',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  json: 'json',
  jsonl: 'json',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  shell: 'bash',
  diff: 'diff',
  patch: 'diff',
  html: 'html',
  css: 'css',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
};

export function resolveLang(hint: string | undefined | null): string | null {
  if (!hint) return null;
  return ALIASES[hint.toLowerCase()] ?? null;
}

export function langFromPath(path: string | undefined | null): string | null {
  if (!path) return null;
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return resolveLang(path.slice(dot + 1));
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (html: string) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./shiki.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; html?: string; error?: string }>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      if (e.data.html !== undefined) job.resolve(e.data.html);
      else job.reject(new Error(e.data.error ?? 'highlight failed'));
    };
  }
  return worker;
}

const cache = new Map<string, string>();
const CACHE_MAX = 400;

export function highlight(
  code: string,
  lang: string,
  theme: 'dark' | 'light',
): Promise<string> {
  const key = `${theme} ${lang} ${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise<string>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      resolve: (html) => {
        if (cache.size >= CACHE_MAX) {
          const first = cache.keys().next().value;
          if (first !== undefined) cache.delete(first);
        }
        cache.set(key, html);
        resolve(html);
      },
      reject,
    });
    getWorker().postMessage({ id, code, lang, theme });
  });
}
