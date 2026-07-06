import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ModelPricing } from './cost/pricing.js';

export function dataDir(): string {
  if (process.env.TURNLOG_DATA_DIR) return process.env.TURNLOG_DATA_DIR;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'turnlog');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'turnlog');
}

export function ensureDataDir(): string {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(ensureDataDir(), 'index.sqlite');
}

export function defaultProjectsDir(): string {
  return process.env.TURNLOG_PROJECTS_DIR ?? path.join(os.homedir(), '.claude', 'projects');
}

export interface Settings {
  /** Per-model pricing overrides (USD per MTok), for Bedrock/enterprise rates. */
  modelPricing?: Record<string, Partial<ModelPricing>>;
  /** Append the "Exported with Turnlog" footer to markdown exports (default true). */
  exportFooter?: boolean;
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}
