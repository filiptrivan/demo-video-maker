/**
 * Smooth scroll-step generation with eased timing.
 */

import type { ScrollStep } from '../types.js';
import { easeInOutCubic } from './easing.js';

/**
 * Break a pixel-based scroll into small, eased increments.
 *
 * Each step scrolls ~40-80 px with timing that follows an ease-in-out-cubic
 * curve (slow start, fast middle, slow end).
 *
 * @param pixels    Total number of pixels to scroll (positive value).
 * @param direction Scroll direction: 'up' subtracts, 'down' adds.
 * @returns         Array of scroll steps with deltaY and delay.
 */
export function generateScrollSteps(
  pixels: number,
  direction: 'up' | 'down',
): ScrollStep[] {
  const totalPixels = Math.abs(pixels);
  if (totalPixels === 0) return [];

  // Determine the number of increments (~40-80 px each)
  const avgIncrement = 60;
  const stepCount = Math.max(2, Math.round(totalPixels / avgIncrement));

  // Build raw eased weights to distribute pixels across steps
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < stepCount; i++) {
    // Position within the sequence, 0-1
    const t0 = i / stepCount;
    const t1 = (i + 1) / stepCount;
    // Weight proportional to the eased speed at the midpoint of this segment
    const midT = (t0 + t1) / 2;
    // Derivative-like proxy: difference of eased values over the segment
    const w = easeInOutCubic(t1) - easeInOutCubic(t0);
    weights.push(w);
    weightSum += w;
  }

  const sign = direction === 'up' ? -1 : 1;
  const baseDelay = 16; // ms, roughly one frame at 60 fps
  const maxDelay = 50;

  const steps: ScrollStep[] = [];
  let remaining = totalPixels;

  for (let i = 0; i < stepCount; i++) {
    const fraction = weights[i] / weightSum;
    // Pixels for this step (last step gets whatever is left to avoid rounding drift)
    const px =
      i === stepCount - 1
        ? remaining
        : Math.max(1, Math.round(totalPixels * fraction));
    remaining -= px;

    // Delay: slower at the extremes, faster in the middle
    const normPos = (i + 0.5) / stepCount;
    const speedFactor = easeInOutCubic(normPos); // 0-1, peaks at center
    const delay = Math.round(maxDelay - (maxDelay - baseDelay) * speedFactor);

    steps.push({ deltaY: sign * px, delayMs: delay });
  }

  return steps;
}
