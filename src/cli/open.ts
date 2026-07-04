import { spawn } from 'node:child_process';

/** Best-effort browser open; failures are silent (the URL is printed anyway). */
export function openBrowser(url: string): void {
  try {
    let cmd: string;
    let args: string[];
    if (process.platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', url.replace(/&/g, '^&')];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // ignore — user can copy the printed URL
  }
}
