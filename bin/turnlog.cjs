#!/usr/bin/env node
'use strict';

// Node version guard. This file must stay parseable by very old Node versions,
// so it is plain CJS with ES5 syntax only.
var major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 20) {
  console.error(
    'turnlog requires Node.js 20 or newer. You are running ' + process.version + '.'
  );
  console.error('Upgrade at https://nodejs.org and try again.');
  process.exit(1);
}

import('../dist/cli/index.js').catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
