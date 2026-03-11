/**
 * Bezier mouse-path generation with Fitts's law timing and micro-jitter.
 */

import type { TimedPoint } from '../types.js';
import { easeInOutCubic, lerp } from './easing.js';

/**
 * Evaluate a cubic Bezier curve at parameter t.
 */
function cubicBezier(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Generate a human-like mouse path from `start` to `end`.
 *
 * - Cubic Bezier with randomized perpendicular control-point offsets.
 * - Fitts's law: duration scales with distance and inversely with target width.
 * - Micro-jitter of +/-0.75 px per sample point.
 * - Ease-in-out-cubic speed curve (slow-fast-slow).
 * - Overshoot correction for long distances (>400 px).
 *
 * @param start       Starting coordinates.
 * @param end         Ending coordinates (click target center).
 * @param targetWidth Approximate width of the click target in px (default 48).
 * @returns           Array of timed points along the path.
 */
export function generateMousePath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  targetWidth: number = 48,
): TimedPoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);

  // ------------------------------------------------------------------
  // Fitts's law: movement time (ms) = a + b * log2(2 * distance / width)
  // We convert that into a step count at ~16 ms per step (≈60 fps).
  // ------------------------------------------------------------------
  const fittsTime = 150 + 120 * Math.log2(Math.max(1, 2 * distance / targetWidth));
  const stepInterval = 16; // ms per sample
  const steps = Math.max(10, Math.round(fittsTime / stepInterval));

  // ------------------------------------------------------------------
  // Control points: offset perpendicular to the start-end line
  // ------------------------------------------------------------------
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // Unit perpendicular to the line
  const len = Math.max(distance, 1);
  const perpX = -dy / len;
  const perpY = dx / len;

  // Random perpendicular offset (up to 25 % of distance, capped at 120 px)
  const maxOffset = Math.min(distance * 0.25, 120);
  const offset1 = (Math.random() - 0.5) * 2 * maxOffset;
  const offset2 = (Math.random() - 0.5) * 2 * maxOffset;

  const cp1x = lerp(start.x, midX, 0.33) + perpX * offset1;
  const cp1y = lerp(start.y, midY, 0.33) + perpY * offset1;
  const cp2x = lerp(midX, end.x, 0.66) + perpX * offset2;
  const cp2y = lerp(midY, end.y, 0.66) + perpY * offset2;

  // ------------------------------------------------------------------
  // Sample the Bezier curve with easeInOutCubic speed ramp
  // ------------------------------------------------------------------
  const points: TimedPoint[] = [];
  let elapsed = 0;

  for (let i = 0; i <= steps; i++) {
    const linearT = i / steps;
    const easedT = easeInOutCubic(linearT);

    let x = cubicBezier(start.x, cp1x, cp2x, end.x, easedT);
    let y = cubicBezier(start.y, cp1y, cp2y, end.y, easedT);

    // Micro-jitter (skip first and last point for clean start/end)
    if (i > 0 && i < steps) {
      x += (Math.random() - 0.5) * 1.5; // +/-0.75 px
      y += (Math.random() - 0.5) * 1.5;
    }

    points.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, timestamp: elapsed });
    elapsed += stepInterval;
  }

  // ------------------------------------------------------------------
  // Overshoot: for long distances, push past target then snap back
  // ------------------------------------------------------------------
  if (distance > 400) {
    const overshootMagnitude = 6 + Math.random() * 8; // 6-14 px past target
    const overshootDirX = dx / len;
    const overshootDirY = dy / len;

    const overshootPoint: TimedPoint = {
      x: Math.round((end.x + overshootDirX * overshootMagnitude) * 100) / 100,
      y: Math.round((end.y + overshootDirY * overshootMagnitude) * 100) / 100,
      timestamp: elapsed,
    };
    points.push(overshootPoint);
    elapsed += stepInterval;

    // Small correction back to target
    const midCorrection: TimedPoint = {
      x: Math.round((end.x + overshootDirX * overshootMagnitude * 0.3) * 100) / 100,
      y: Math.round((end.y + overshootDirY * overshootMagnitude * 0.3) * 100) / 100,
      timestamp: elapsed,
    };
    points.push(midCorrection);
    elapsed += stepInterval;

    // Final landing
    points.push({ x: end.x, y: end.y, timestamp: elapsed });
  }

  return points;
}
