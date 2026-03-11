/**
 * Human-like typing sequence generation with Gaussian timing and typo simulation.
 */

import type { KeystrokeEvent } from '../types.js';

// Characters adjacent on a QWERTY layout, used for plausible typos.
const ADJACENT_KEYS: Record<string, string[]> = {
  a: ['s', 'q', 'w', 'z'],
  b: ['v', 'g', 'h', 'n'],
  c: ['x', 'd', 'f', 'v'],
  d: ['s', 'e', 'r', 'f', 'c', 'x'],
  e: ['w', 'r', 'd', 's'],
  f: ['d', 'r', 't', 'g', 'v', 'c'],
  g: ['f', 't', 'y', 'h', 'b', 'v'],
  h: ['g', 'y', 'u', 'j', 'n', 'b'],
  i: ['u', 'o', 'k', 'j'],
  j: ['h', 'u', 'i', 'k', 'n', 'm'],
  k: ['j', 'i', 'o', 'l', 'm'],
  l: ['k', 'o', 'p', ';'],
  m: ['n', 'j', 'k'],
  n: ['b', 'h', 'j', 'm'],
  o: ['i', 'p', 'l', 'k'],
  p: ['o', 'l', '['],
  q: ['w', 'a'],
  r: ['e', 't', 'f', 'd'],
  s: ['a', 'w', 'e', 'd', 'x', 'z'],
  t: ['r', 'y', 'g', 'f'],
  u: ['y', 'i', 'j', 'h'],
  v: ['c', 'f', 'g', 'b'],
  w: ['q', 'e', 's', 'a'],
  x: ['z', 's', 'd', 'c'],
  y: ['t', 'u', 'h', 'g'],
  z: ['a', 's', 'x'],
};

/**
 * Approximate Gaussian random using the Box-Muller transform.
 * Returns a value with the given mean and standard deviation.
 */
function gaussianRandom(mean: number, stddev: number): number {
  let u = 0;
  let v = 0;
  // Avoid log(0)
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stddev;
}

/**
 * Pick a plausible wrong key adjacent to `key` on a QWERTY layout.
 * Falls back to the original key if no adjacency data is available.
 */
function adjacentKey(key: string): string {
  const lower = key.toLowerCase();
  const neighbors = ADJACENT_KEYS[lower];
  if (!neighbors || neighbors.length === 0) return key;
  const picked = neighbors[Math.floor(Math.random() * neighbors.length)];
  // Preserve original case
  return key === key.toUpperCase() ? picked.toUpperCase() : picked;
}

/**
 * Generate a human-like typing sequence for the given text.
 *
 * - Base inter-key delay: ~80 ms with +/-40 ms Gaussian jitter.
 * - Longer pause after spaces and punctuation (~150 ms).
 * - ~3 % chance of a typo per character: wrong key, pause, backspace, correct key.
 *
 * @param text The string to type.
 * @returns    An array of keystroke events.
 */
export function generateTypingSequence(text: string): KeystrokeEvent[] {
  const events: KeystrokeEvent[] = [];
  const TYPO_CHANCE = 0.03;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Determine base delay
    let baseDelay: number;
    if (i === 0) {
      // Very first keystroke has a short initial pause
      baseDelay = 50;
    } else {
      const prev = text[i - 1];
      const isAfterPause = prev === ' ' || /[.,;:!?]/.test(prev);
      baseDelay = isAfterPause
        ? Math.max(40, gaussianRandom(150, 30))
        : Math.max(30, gaussianRandom(80, 40));
    }

    const delay = Math.round(baseDelay);

    // Typo simulation (only for simple alpha characters)
    const isAlpha = /^[a-zA-Z]$/.test(char);
    if (isAlpha && Math.random() < TYPO_CHANCE) {
      // 1. Type the wrong key
      const wrongKey = adjacentKey(char);
      events.push({ key: wrongKey, delayMs: delay, isCorrection: false });

      // 2. Short pause (realising the mistake)
      const pauseDelay = Math.round(Math.max(80, gaussianRandom(200, 50)));

      // 3. Backspace
      events.push({ key: 'Backspace', delayMs: pauseDelay, isCorrection: true });

      // 4. Correct key
      const correctionDelay = Math.round(Math.max(40, gaussianRandom(100, 30)));
      events.push({ key: char, delayMs: correctionDelay, isCorrection: true });
    } else {
      events.push({ key: char, delayMs: delay });
    }
  }

  return events;
}
