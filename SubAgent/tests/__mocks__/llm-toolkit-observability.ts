/**
 * Mock for llm-toolkit-observability used in tests.
 * Provides a no-op Logger interface to avoid ESM resolution issues
 * with the workspace-linked Observability package.
 */

const noopLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  child: () => noopLogger,
};

export function getLogger() {
  return noopLogger;
}

export type Logger = typeof noopLogger;
