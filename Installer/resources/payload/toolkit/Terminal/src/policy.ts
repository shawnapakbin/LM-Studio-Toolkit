import path from "path";

export const DEFAULT_MAX_OUTPUT_CHARS = Number(process.env.TERMINAL_MAX_OUTPUT_CHARS ?? 50000);

export const WORKSPACE_ROOT = path.resolve(process.env.TERMINAL_WORKSPACE_ROOT ?? process.cwd());

export const DENY_PATTERNS: RegExp[] = [
  /(^|\s)rm\s+-rf(\s|$)/i,
  /(^|\s)del\s+\/s\s+\/q(\s|$)/i,
  /(^|\s)format(\s|$)/i,
  /(^|\s)mkfs(\s|$)/i,
  /(^|\s)dd\s+if=/i,
  /(^|\s)powershell\b.*-encodedcommand\b/i,
  /(^|\s)(curl|wget|Invoke-WebRequest)\b.*\|/i,
];

export function isCommandBlocked(command: string): boolean {
  return DENY_PATTERNS.some((pattern) => pattern.test(command));
}

export function resolveSafeCwd(
  workspaceRoot: string,
  inputCwd?: string,
): { ok: true; cwd: string } | { ok: false; message: string } {
  if (!inputCwd) {
    return { ok: true, cwd: workspaceRoot };
  }

  const resolved = path.resolve(workspaceRoot, inputCwd);
  const relative = path.relative(workspaceRoot, resolved);
  const outsideRoot = relative.startsWith("..") || path.isAbsolute(relative);

  if (outsideRoot) {
    return {
      ok: false,
      message: `cwd must stay within workspace root: ${workspaceRoot}`,
    };
  }

  return { ok: true, cwd: resolved };
}

export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n--- OUTPUT TRUNCATED (${text.length - maxChars} chars omitted) ---`;
}
