import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getFFmpegScreenCaptureArgs, checkFFmpegInstalled } from '../utils/platform.js';
import { debug, error as logError } from '../utils/logger.js';

export class Recorder {
  private process: ChildProcess | null = null;
  private outputPath: string;
  private startTime: number = 0;

  constructor(private fps: number = 30) {
    this.outputPath = join(tmpdir(), `demo-raw-${randomBytes(4).toString('hex')}.mp4`);
  }

  start(): string {
    if (!checkFFmpegInstalled()) {
      throw new Error('FFmpeg is not installed or not on PATH. Please install FFmpeg first.');
    }

    const captureArgs = getFFmpegScreenCaptureArgs(this.fps);

    const args = [
      ...captureArgs,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-y',
      this.outputPath,
    ];

    debug('Starting FFmpeg with args:', args.join(' '));

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      debug('[FFmpeg]', data.toString().trim());
    });

    this.process.on('error', (err) => {
      logError('FFmpeg process error:', err.message);
    });

    this.startTime = Date.now();
    debug('Recording started to:', this.outputPath);

    return this.outputPath;
  }

  async stop(): Promise<{ videoPath: string; durationMs: number }> {
    const durationMs = Date.now() - this.startTime;

    if (!this.process) {
      throw new Error('Recording not started');
    }

    return new Promise((resolve, reject) => {
      const proc = this.process!;

      proc.on('close', (code) => {
        debug('FFmpeg exited with code:', code);
        this.process = null;
        resolve({
          videoPath: this.outputPath,
          durationMs,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });

      // Send 'q' to FFmpeg stdin to gracefully stop recording
      if (proc.stdin) {
        proc.stdin.write('q');
        proc.stdin.end();
      }

      // Fallback: kill after 5 seconds if it hasn't exited
      setTimeout(() => {
        if (this.process) {
          debug('FFmpeg did not exit gracefully, killing process');
          proc.kill('SIGTERM');
        }
      }, 5000);
    });
  }

  getOutputPath(): string {
    return this.outputPath;
  }

  isRecording(): boolean {
    return this.process !== null;
  }
}
