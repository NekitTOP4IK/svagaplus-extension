const PREFIX = '[TSR]';

/** Debug logs — hidden by default in browser consoles (set level to "Verbose" to see). */
export function debug(module: string, ...args: unknown[]): void {
  console.debug(PREFIX, `[${module}]`, ...args);
}

/** Always-visible info log. */
export function info(module: string, ...args: unknown[]): void {
  console.info(PREFIX, `[${module}]`, ...args);
}

/** Warning — visible by default. */
export function warn(module: string, ...args: unknown[]): void {
  console.warn(PREFIX, `[${module}]`, ...args);
}

/** Error — always visible. */
export function error(module: string, ...args: unknown[]): void {
  console.error(PREFIX, `[${module}]`, ...args);
}
