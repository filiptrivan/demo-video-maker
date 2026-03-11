import { execSync, exec } from 'node:child_process';
import { platform } from 'node:os';

export type Platform = 'windows' | 'macos' | 'linux';

export function getPlatform(): Platform {
  const p = platform();
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

export function getFFmpegScreenCaptureArgs(fps: number): string[] {
  const p = getPlatform();
  switch (p) {
    case 'windows':
      return ['-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop'];
    case 'macos':
      return ['-f', 'avfoundation', '-framerate', String(fps), '-i', '1:none'];
    case 'linux':
      const display = process.env.DISPLAY || ':0.0';
      return ['-f', 'x11grab', '-framerate', String(fps), '-i', display];
  }
}

export function checkFFmpegInstalled(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function openApp(name: string): Promise<void> {
  const p = getPlatform();
  return new Promise((resolve, reject) => {
    let cmd: string;
    switch (p) {
      case 'windows':
        cmd = `start "" "${name}"`;
        break;
      case 'macos':
        cmd = `open -a "${name}"`;
        break;
      case 'linux':
        cmd = `${name} &`;
        break;
    }
    exec(cmd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
