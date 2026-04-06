import path from "path";

export const MAX_REDIRECTS = 10;

export const ALLOWED_CONTENT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return true;
  }

  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  const private172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  return false;
}

export function validateTargetUrl(
  urlValue: string,
): { ok: true } | { ok: false; message: string; errorCode: string } {
  try {
    const parsed = new URL(urlValue);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        ok: false,
        message: "Only http and https URLs are allowed.",
        errorCode: "INVALID_INPUT",
      };
    }

    if (isBlockedHostname(parsed.hostname)) {
      return {
        ok: false,
        message: "Blocked by SSRF policy: private, loopback, or link-local hosts are not allowed.",
        errorCode: "POLICY_BLOCKED",
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: "Invalid URL.", errorCode: "INVALID_INPUT" };
  }
}

export function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return ALLOWED_CONTENT_TYPES.some((allowed) => normalized.includes(allowed));
}

export function getWorkspaceRoot(): string {
  return path.resolve(process.env.DOC_SCRAPER_WORKSPACE_ROOT || process.cwd());
}

export function validatePath(
  filePath: string,
  workspaceRoot: string,
): { valid: boolean; error?: string } {
  const normalized = path.normalize(filePath);
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, normalized);
  const normalizedRoot = root.toLowerCase();
  const normalizedAbsolute = absolutePath.toLowerCase();

  if (
    !(
      normalizedAbsolute === normalizedRoot ||
      normalizedAbsolute.startsWith(`${normalizedRoot}${path.sep}`)
    )
  ) {
    return {
      valid: false,
      error: `Path traversal detected: ${filePath} escapes workspace boundary`,
    };
  }

  if (normalized.includes("..")) {
    return {
      valid: false,
      error: "Invalid path: contains parent directory reference (..)",
    };
  }

  return { valid: true };
}

export function isBlockedPath(filePath: string): { blocked: boolean; reason?: string } {
  const normalized = path.normalize(filePath).replace(/\\/g, "/").toLowerCase();
  const blockedPatterns = [
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    /\/proc\//,
    /\/sys\//,
    /\/dev\//,
    /\/windows\/system32\//i,
    /c:\\windows\\system32\\/i,
    /\.aws\/credentials/,
    /\.ssh\/id_rsa/,
    /\.ssh\/id_ed25519/,
    /\.gnupg\//,
    /\.npmrc/,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(normalized)) {
      return { blocked: true, reason: `Access to sensitive path blocked: ${filePath}` };
    }
  }

  return { blocked: false };
}

export function clampTimeout(timeoutMs?: number): number {
  const defaultTimeout = Number(process.env.DOC_SCRAPER_DEFAULT_TIMEOUT_MS ?? 20000);
  const maxTimeout = Number(process.env.DOC_SCRAPER_MAX_TIMEOUT_MS ?? 60000);
  const fromReq = Number(timeoutMs ?? defaultTimeout);
  if (!Number.isFinite(fromReq)) {
    return defaultTimeout;
  }
  return Math.min(Math.max(fromReq, 1000), maxTimeout);
}

export function clampMaxChars(maxContentChars?: number): number {
  const maxChars = Number(process.env.DOC_SCRAPER_MAX_CONTENT_CHARS ?? 50000);
  const fromReq = Number(maxContentChars ?? maxChars);
  if (!Number.isFinite(fromReq)) {
    return maxChars;
  }
  return Math.min(Math.max(fromReq, 500), maxChars);
}

export function clampDepth(depth?: number): number {
  const value = Number(depth ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(value), 0), 3);
}

export function clampMaxPages(maxPages?: number): number {
  const value = Number(maxPages ?? 1);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(Math.max(Math.floor(value), 1), 20);
}
