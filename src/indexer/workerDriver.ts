import { Worker } from 'node:worker_threads';
import type { IndexDriver, IndexStatus } from './driver.js';
import type { ScanSummary } from './indexer.js';
import type { ModelPricing } from '../cost/pricing.js';

/**
 * Runs the indexer in a worker thread so JSONL parsing and SQLite writes never
 * block the API server. The worker owns the sole writing connection; the
 * server reads through its own connection (safe under WAL).
 */
export class WorkerDriver implements IndexDriver {
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private current: IndexStatus = {
    state: 'idle',
    filesTotal: 0,
    filesDone: 0,
    lastError: null,
    lastScanAt: null,
  };

  constructor(opts: {
    dbPath: string;
    projectsDir: string;
    pricingOverrides?: Record<string, Partial<ModelPricing>>;
  }) {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: opts });
    this.worker.on('message', (msg: any) => {
      if (msg.type === 'progress') {
        this.current.filesTotal = msg.filesTotal;
        this.current.filesDone = msg.filesDone;
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      this.settle();
      if (msg.type === 'done') entry.resolve(msg.result);
      else {
        this.current.lastError = msg.message;
        entry.reject(new Error(msg.message));
      }
    });
    this.worker.on('error', (err) => {
      this.current.lastError = err.message;
      this.current.state = 'idle';
      for (const entry of this.pending.values()) entry.reject(err);
      this.pending.clear();
    });
  }

  private settle(): void {
    if (this.pending.size === 0) {
      this.current.state = 'idle';
      this.current.lastScanAt = new Date().toISOString();
    }
  }

  private send<T>(cmd: 'scan' | 'rebuild' | 'file', filePath?: string): Promise<T> {
    const id = this.nextId++;
    this.current.state = 'indexing';
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, cmd, filePath });
    });
  }

  status(): IndexStatus {
    return { ...this.current };
  }

  scan(): Promise<ScanSummary> {
    return this.send<ScanSummary>('scan');
  }

  async indexFile(filePath: string): Promise<void> {
    await this.send('file', filePath);
  }

  rebuild(): Promise<ScanSummary> {
    return this.send<ScanSummary>('rebuild');
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}
