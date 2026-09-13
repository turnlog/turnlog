#!/usr/bin/env node
'use strict';

// Node version guard. This file must stay parseable by very old Node versions,
// so it is plain CJS with ES5 syntax only. 22.13 is where node:sqlite —
// Turnlog's database, no native addon involved — lost its experimental flag.
var parts = process.versions.node.split('.');
var major = parseInt(parts[0], 10);
var minor = parseInt(parts[1], 10);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    'turnlog requires Node.js 22.13 or newer. You are running ' + process.version + '.'
  );
  console.error('Upgrade at https://nodejs.org and try again.');
  process.exit(1);
}

// node:sqlite prints one ExperimentalWarning on Node 22; Turnlog relies on it
// deliberately, so drop that line and nothing else. The indexer worker thread
// carries the same patch (src/indexer/sqliteWarning.ts).
var emitWarning = process.emitWarning;
process.emitWarning = function (warning, type) {
  var name = typeof type === 'string' ? type : type && type.type;
  if (name === 'ExperimentalWarning' && /SQLite/.test(String(warning))) return;
  return emitWarning.apply(process, arguments);
};

import('../dist/cli/index.js').catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
