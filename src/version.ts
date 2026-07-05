import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const APP_VERSION: string = pkg.version;

/**
 * Version of the parser/adapter pipeline. Bumping this forces a full reindex
 * of every session file on the next scan.
 */
export const ADAPTER_VERSION = 2;
