/**
 * Minimal built-in page served until the real web UI ships in Phase 2. Proves
 * the whole pipeline end to end: status, stats, and live search over the API.
 */
export function placeholderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Turnlog</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 780px; padding: 48px 24px; background: #101014;
         color: #e6e6ea; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h1 small { color: #8a8a93; font-weight: 400; font-size: 13px; margin-left: 8px; }
  #status { color: #8a8a93; font-size: 13px; margin-bottom: 24px; }
  input { width: 100%; padding: 10px 14px; font-size: 15px; border-radius: 8px;
          border: 1px solid #2c2c33; background: #17171c; color: inherit; outline: none; }
  input:focus { border-color: #5a5af0; }
  .group { margin-top: 20px; }
  .group h2 { font-size: 13px; color: #b0b0ba; margin: 0 0 6px; font-weight: 600; }
  .hit { padding: 8px 12px; border-left: 2px solid #2c2c33; margin-bottom: 6px;
         white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace;
         font-size: 12.5px; color: #c8c8d0; }
  .hit mark { background: #5a5af0; color: #fff; border-radius: 2px; padding: 0 1px; }
  .meta { color: #6a6a73; font-size: 11px; margin-top: 2px; }
  #empty { color: #6a6a73; margin-top: 24px; }
</style>
</head>
<body>
<h1>Turnlog <small>full UI coming soon — search works now</small></h1>
<div id="status">connecting…</div>
<input id="q" type="search" placeholder="Search every session you've ever run…" autofocus>
<div id="results"></div>
<div id="empty"></div>
<script>
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || sessionStorage.getItem('turnlog-token') || '';
  if (params.get('token')) {
    sessionStorage.setItem('turnlog-token', token);
    history.replaceState(null, '', '/');
  }
  const api = (path) => fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token))
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

  const statusEl = document.getElementById('status');
  async function refreshStatus() {
    try {
      const [status, stats] = await Promise.all([api('/api/status'), api('/api/stats')]);
      const indexing = status.state === 'indexing'
        ? ' · indexing ' + status.filesDone + '/' + status.filesTotal : '';
      statusEl.textContent = stats.sessions + ' sessions · ' + stats.messages
        + ' messages · ~$' + stats.costUsd.toFixed(2) + ' total (est.)' + indexing;
      if (status.state === 'indexing') setTimeout(refreshStatus, 1000);
    } catch (e) { statusEl.textContent = 'API unreachable: ' + e.message; }
  }
  refreshStatus();

  const resultsEl = document.getElementById('results');
  const emptyEl = document.getElementById('empty');
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const renderSnippet = (s) => esc(s).replaceAll('\\uE000', '<mark>').replaceAll('\\uE001', '</mark>');

  let timer;
  document.getElementById('q').addEventListener('input', (ev) => {
    clearTimeout(timer);
    const query = ev.target.value.trim();
    timer = setTimeout(async () => {
      if (!query) { resultsEl.innerHTML = ''; emptyEl.textContent = ''; return; }
      const data = await api('/api/search?q=' + encodeURIComponent(query));
      resultsEl.innerHTML = data.groups.map((g) =>
        '<div class="group"><h2>' + esc(g.session.projectPath || g.session.projectKey || g.session.id)
        + ' · ' + (g.session.startedAt || '').slice(0, 10) + '</h2>'
        + g.hits.map((h) =>
            '<div class="hit">' + renderSnippet(h.snippet)
            + '<div class="meta">' + esc(h.kind) + (h.toolName ? ' · ' + esc(h.toolName) : '')
            + ' · #' + h.idx + '</div></div>').join('')
        + '</div>').join('');
      emptyEl.textContent = data.groups.length === 0 ? 'No matches.' : '';
    }, 200);
  });
})();
</script>
</body>
</html>`;
}
