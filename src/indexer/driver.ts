import type Database from 'better-sqlite3';
import { checkpointWal, checkpointWalThrottled } from './db.js';
import { Indexer, type ScanSummary, type IndexProgress, type IndexerOptions } from './indexer.js';

export interface IndexStatus {
  state: 'idle' | 'indexing';
  filesTotal: number;
  filesDone: number;
  lastError: string | null;
  lastScanAt: string | null;
}

/**
 * The server talks to indexing through this interface, so tests can run the
 * indexer in-process while production runs it in a worker thread.
 */
export interface IndexDriver {
  status(): IndexStatus;
  /** Summary of the last full scan/rebuild this launch (null before one ran) —
   *  the health panel's source for skipped files. */
  lastScan(): ScanSummary | null;
  scan(): Promise<ScanSummary>;
  indexFile(filePath: string): Promise<void>;
  rebuild(): Promise<ScanSummary>;
  close(): Promise<void>;
}

export class InProcessDriver implements IndexDriver {
  private readonly indexer: Indexer;
  private current: IndexStatus = {
    state: 'idle',
    filesTotal: 0,
    filesDone: 0,
    lastError: null,
    lastScanAt: null,
  };
  private queue: Promise<unknown> = Promise.resolve();
  private lastSummary: ScanSummary | null = null;

  constructor(
    private readonly db: Database.Database,
    opts: IndexerOptions,
  ) {
    this.indexer = new Indexer(db, opts);
  }

  status(): IndexStatus {
    return { ...this.current };
  }

  lastScan(): ScanSummary | null {
    return this.lastSummary;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private onProgress = (p: IndexProgress) => {
    this.current.filesTotal = p.filesTotal;
    this.current.filesDone = p.filesDone;
  };

  private async run<T>(op: () => Promise<T>): Promise<T> {
    this.current.state = 'indexing';
    this.current.lastError = null;
    try {
      return await op();
    } catch (err) {
      this.current.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.current.state = 'idle';
      this.current.lastScanAt = new Date().toISOString();
    }
  }

  /** Truncate the log a full pass just grew — the worker driver does the same. */
  private remember(summary: ScanSummary): ScanSummary {
    this.lastSummary = summary;
    checkpointWal(this.db);
    return summary;
  }

  scan(): Promise<ScanSummary> {
    return this.enqueue(() =>
      this.run(() => this.indexer.scanAll(this.onProgress).then((s) => this.remember(s))),
    );
  }

  indexFile(filePath: string): Promise<void> {
    return this.enqueue(() =>
      this.run(async () => {
        await this.indexer.indexFile(filePath);
        // Same throttled truncation as the worker driver — live events are
        // the only writes a long-lived server sees after its boot scan.
        checkpointWalThrottled(this.db);
      }),
    );
  }

  rebuild(): Promise<ScanSummary> {
    return this.enqueue(() =>
      this.run(() => this.indexer.rebuild(this.onProgress).then((s) => this.remember(s))),
    );
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
