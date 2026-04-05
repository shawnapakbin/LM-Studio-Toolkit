export const MAX_REDIRECTS = 10;

export const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/xhtml+xml",
  "application/xml",
  "application/json", // added v2.1.0
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
