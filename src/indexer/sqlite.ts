/**
 * The one place that touches `node:sqlite`. Node's built-in SQLite replaced
 * better-sqlite3 (a native addon) so that installing Turnlog needs no install
 * script — npm 12 blocks those by default, and npm 10/11 could not install
 * the addon's successor on Windows without a C++ toolchain. Everything else
 * imports the driver through here, so the shape better-sqlite3 gave the rest
 * of the code (transactions, simple pragmas, a 5s busy wait) lives on.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type { DatabaseSync, StatementSync };

/** What a statement can bind: null, number, bigint, string, or bytes. */
export type SqlValue = SQLInputValue;

export interface OpenOptions {
  /** Open read-only; the file must already exist. */
  readOnly?: boolean;
}

/**
 * Open a database with the connection settings the app relies on: a 5s busy
 * wait (the worker writes while the server and the MCP process read), and a
 * 16MB page cache (SQLite's default is 2MB — hot lookups against a multi-GB
 * index thrash it).
 */
export function openSqlite(path: string, opts: OpenOptions = {}): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: opts.readOnly ?? false });
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA cache_size = -16000');
  return db;
}

/** The first column of the first row a PRAGMA returns, or undefined. */
export function pragma(db: DatabaseSync, statement: string): unknown {
  const row = db.prepare(`PRAGMA ${statement}`).get();
  if (!row) return undefined;
  for (const key in row) return row[key];
  return undefined;
}

/** The main database file's path; ':memory:' or '' for a file-less one. */
export function databasePath(db: DatabaseSync): string {
  const row = db.prepare(`SELECT file FROM pragma_database_list WHERE name = 'main'`).get();
  return typeof row?.file === 'string' ? row.file : '';
}

const depth = new WeakMap<DatabaseSync, number>();

/**
 * Wrap `fn` so each call runs inside a transaction: committed when it
 * returns, rolled back when it throws (the error propagates). A call made
 * while another wrapped call is running on the same connection becomes a
 * savepoint, so nesting composes instead of failing on the inner BEGIN.
 */
export function transaction<A extends unknown[], R>(
  db: DatabaseSync,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    const level = depth.get(db) ?? 0;
    const savepoint = level > 0 ? `tx_${level}` : null;
    db.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    depth.set(db, level + 1);
    try {
      const result = fn(...args);
      db.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      } catch {
        // The connection is already out of the transaction (closed, or the
        // error itself rolled it back); the original error is the news.
      }
      throw err;
    } finally {
      depth.set(db, level);
    }
  };
}

/** A column value as text: node:sqlite hands BLOBs back as Uint8Array. */
export function columnText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return undefined;
}
