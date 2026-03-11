let debugMode = false;

export function setDebug(enabled: boolean): void {
  debugMode = enabled;
}

export function debug(...args: unknown[]): void {
  if (debugMode) {
    console.log('[DEBUG]', ...args);
  }
}

export function info(...args: unknown[]): void {
  console.log('[INFO]', ...args);
}

export function warn(...args: unknown[]): void {
  console.warn('[WARN]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[ERROR]', ...args);
}
