import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { CameraKeyframe, RecordingSession } from '../types.js';
import { lerp, clamp } from '../motion/easing.js';
import { debug, info } from '../utils/logger.js';

interface RenderOptions {
  outputPath: string;
  screenWidth: number;
  screenHeight: number;
  outputWidth: number;
  outputHeight: number;
}

interface CropSegment {
  startTime: number;
  endTime: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

export class Renderer {
  constructor(private options: RenderOptions) {}

  async render(session: RecordingSession): Promise<string> {
    info('Starting video post-processing...');

    const keyframes = session.cameraKeyframes;
    const { screenWidth, screenHeight, outputWidth, outputHeight, outputPath } = this.options;

    // If no meaningful zoom keyframes, just copy/re-encode
    const hasZoom = keyframes.some(kf => kf.zoom > 1.05);
    if (!hasZoom) {
      info('No zoom keyframes, re-encoding with quality settings...');
      return this.simpleReencode(session.videoPath, outputPath);
    }

    // Build crop segments from keyframes
    const segments = this.buildCropSegments(keyframes, session.durationMs, screenWidth, screenHeight);

    // Generate FFmpeg filter_complex with crop per segment
    const filterScript = this.generateFilterScript(segments, screenWidth, screenHeight, outputWidth, outputHeight);
    debug('Filter script:', filterScript);

    // Write filter script to temp file
    const filterPath = join(tmpdir(), `demo-filter-${randomBytes(4).toString('hex')}.txt`);
    await writeFile(filterPath, filterScript, 'utf-8');

    try {
      await this.runFFmpeg(session.videoPath, outputPath, filterPath);
    } finally {
      // Clean up temp filter file
      try { await unlink(filterPath); } catch { /* ignore */ }
    }

    info(`Rendered video saved to: ${outputPath}`);
    return outputPath;
  }

  private buildCropSegments(
    keyframes: CameraKeyframe[],
    durationMs: number,
    screenW: number,
    screenH: number
  ): CropSegment[] {
    if (keyframes.length === 0) {
      return [{
        startTime: 0,
        endTime: durationMs / 1000,
        cropX: 0,
        cropY: 0,
        cropW: screenW,
        cropH: screenH,
      }];
    }

    const segments: CropSegment[] = [];

    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i];
      const nextKf = keyframes[i + 1];
      const startTime = kf.timestamp / 1000;
      const endTime = nextKf ? nextKf.timestamp / 1000 : durationMs / 1000;

      if (endTime <= startTime) continue;

      const cropW = Math.round(screenW / kf.zoom);
      const cropH = Math.round(screenH / kf.zoom);
      const cropX = clamp(Math.round(kf.centerX - cropW / 2), 0, screenW - cropW);
      const cropY = clamp(Math.round(kf.centerY - cropH / 2), 0, screenH - cropH);

      segments.push({ startTime, endTime, cropX, cropY, cropW, cropH });
    }

    return segments;
  }

  private generateFilterScript(
    segments: CropSegment[],
    screenW: number,
    screenH: number,
    outW: number,
    outH: number
  ): string {
    // For simplicity, we use the sendcmd approach with a single crop+scale filter
    // that changes parameters over time via timeline editing
    // Simpler approach: use expression-based crop filter

    if (segments.length <= 1) {
      const s = segments[0] || { cropX: 0, cropY: 0, cropW: screenW, cropH: screenH };
      return `crop=${s.cropW}:${s.cropH}:${s.cropX}:${s.cropY},scale=${outW}:${outH}:flags=lanczos`;
    }

    // Build a timeline-based crop using if/between expressions
    // FFmpeg crop filter supports expressions with time variable 't'
    const xExpr = this.buildTimeExpr(segments.map(s => ({ time: s.startTime, value: s.cropX })));
    const yExpr = this.buildTimeExpr(segments.map(s => ({ time: s.startTime, value: s.cropY })));
    const wExpr = this.buildTimeExpr(segments.map(s => ({ time: s.startTime, value: s.cropW })));
    const hExpr = this.buildTimeExpr(segments.map(s => ({ time: s.startTime, value: s.cropH })));

    return `crop='${wExpr}:${hExpr}:${xExpr}:${yExpr}',scale=${outW}:${outH}:flags=lanczos`;
  }

  private buildTimeExpr(points: { time: number; value: number }[]): string {
    if (points.length === 0) return '0';
    if (points.length === 1) return String(points[0].value);

    // Build nested if(between(t,...),value,...) expression
    let expr = String(points[points.length - 1].value);
    for (let i = points.length - 2; i >= 0; i--) {
      const p = points[i];
      const next = points[i + 1];
      // Use linear interpolation between keyframes
      const duration = next.time - p.time;
      if (duration > 0) {
        const slope = (next.value - p.value) / duration;
        const interpExpr = `${p.value}+${slope.toFixed(4)}*(t-${p.time.toFixed(4)})`;
        expr = `if(between(t\\,${p.time.toFixed(4)}\\,${next.time.toFixed(4)})\\,${interpExpr}\\,${expr})`;
      } else {
        expr = `if(gte(t\\,${p.time.toFixed(4)})\\,${p.value}\\,${expr})`;
      }
    }

    return expr;
  }

  private async simpleReencode(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ];

      debug('FFmpeg re-encode args:', args.join(' '));

      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        debug('[FFmpeg]', data.toString().trim());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private async runFFmpeg(inputPath: string, outputPath: string, filterPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Read filter from file to avoid shell escaping issues
      const args = [
        '-i', inputPath,
        '-filter_script:v', filterPath,
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ];

      debug('FFmpeg render args:', args.join(' '));

      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        debug('[FFmpeg]', data.toString().trim());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // If filter_script fails, fallback to simple re-encode
          debug('Filter script failed, falling back to simple re-encode');
          this.simpleReencode(inputPath, outputPath).then(() => resolve()).catch(reject);
        }
      });

      proc.on('error', reject);
    });
  }
}
