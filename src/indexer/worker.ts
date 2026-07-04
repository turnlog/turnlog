import { parentPort, workerData } from 'node:worker_threads';
import { openDb } from './db.js';
import { Indexer, type IndexProgress } from './indexer.js';

interface WorkerInit {
  dbPath: string;
  projectsDir: string;
  pricingOverrides?: Record<string, Partial<import('../cost/pricing.js').ModelPricing>>;
}

interface Command {
  id: number;
  cmd: 'scan' | 'rebuild' | 'file';
  filePath?: string;
}

if (!parentPort) throw new Error('indexer worker must run inside a worker thread');
const port = parentPort;

const { dbPath, projectsDir, pricingOverrides } = workerData as WorkerInit;
const db = openDb(dbPath);
const indexer = new Indexer(db, { projectsDir, pricingOverrides });

let queue: Promise<unknown> = Promise.resolve();

const onProgress = (p: IndexProgress) => {
  port.postMessage({ type: 'progress', filesTotal: p.filesTotal, filesDone: p.filesDone });
};

port.on('message', (msg: Command) => {
  const op = async () => {
    try {
      let result: unknown;
      switch (msg.cmd) {
        case 'scan':
          result = await indexer.scanAll(onProgress);
          break;
        case 'rebuild':
          result = await indexer.rebuild(onProgress);
          break;
        case 'file':
          result = await indexer.indexFile(msg.filePath ?? '');
          break;
      }
      port.postMessage({ type: 'done', id: msg.id, result });
    } catch (err) {
      port.postMessage({
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
  queue = queue.then(op, op);
});
