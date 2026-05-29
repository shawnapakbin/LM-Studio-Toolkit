import path from "path";
import fs from "fs/promises";
import mammoth from "mammoth";
import {
  MAX_REDIRECTS,
  clampDepth,
  clampMaxChars,
  clampMaxPages,
  clampTimeout,
  getWorkspaceRoot,
  isAllowedContentType,
  isBlockedPath,
  validatePath,
  validateTargetUrl,
} from "./policy";

export type ReadDocumentInput = {
  url?: string;
  filePath?: string;
  headers?: Record<string, string>;
  cookies?: string;
  timeoutMs?: number;
  maxContentChars?: number;
  formatHint?: string;
  profile?: "mvp" | "premium";
  pdfPassword?: string;
};

export type CrawlDocumentsInput = {
  url: string;
  headers?: Record<string, string>;
  cookies?: string;
  timeoutMs?: number;
  maxContentChars?: number;
  depth?: number;
  maxPages?: number;
  sameOriginOnly?: boolean;
};

export type Section = {
  heading: string;
  level: number;
  content: string;
};

export type DocumentDescription = {
  text: string;
  method: "deterministic-section-aware";
  qualityScore: number;
};

export type DocumentReadResult = {
  success: boolean;
  source: "remote" | "local";
  sourceRef: string;
  format: string;
  title: string;
  content: string;
  contentLength: number;
  sections: Section[];
  description: DocumentDescription;
  isEncrypted: boolean;
  encryptionType?: string;
  encryptionStatusCode?: string;
  encryptionUserMessage?: string;
  error?: string;
  errorCode?: string;
};

export type CrawlResult = {
  success: boolean;
  rootUrl: string;
  pagesVisited: number;
  maxPages: number;
  depth: number;
  results: DocumentReadResult[];
  errors: string[];
};

const MAX_CONTENT_BYTES = Number(process.env.DOC_SCRAPER_MAX_CONTENT_BYTES ?? 50 * 1024 * 1024);

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function inferSectionsFromText(text: string): Section[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sections: Section[] = [];
  let currentHeading = "Overview";
  let currentLevel = 1;
  let buffer: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      if (buffer.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: buffer.join(" ").trim(),
        });
      }
      currentHeading = line.replace(/^#{1,6}\s+/, "").trim();
      currentLevel = line.match(/^#+/)?.[0].length ?? 1;
      buffer = [];
      continue;
    }

    if (/^[A-Z][A-Za-z0-9\s\-:]{3,70}$/.test(line)) {
      if (buffer.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: buffer.join(" ").trim(),
        });
      }
      currentHeading = line;
      currentLevel = 2;
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  if (buffer.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: buffer.join(" ").trim(),
    });
  }

  return sections.slice(0, 20);
}

function buildDescription(
  title: string,
  sections: Section[],
  content: string,
): DocumentDescription {
  const sentences = splitSentences(content).slice(0, 80);
  const headingTokens = sections
    .flatMap((s) => s.heading.toLowerCase().split(/\W+/))
    .filter((w) => w.length > 3);

  const tokenWeights = new Map<string, number>();
  for (const token of headingTokens) {
    tokenWeights.set(token, (tokenWeights.get(token) ?? 0) + 2);
  }

  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().split(/\W+/);
    let score = 0;
    for (const word of words) {
      score += tokenWeights.get(word) ?? 0;
    }
    if (index < 3) {
      score += 2;
    }
    if (index > sentences.length - 4) {
      score += 1;
    }
    if (/\b(summary|conclusion|overview|result|findings?)\b/i.test(sentence)) {
      score += 2;
    }
    return { sentence, score };
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.sentence);

  const deduped: string[] = [];
  for (const sentence of top) {
    const normalized = sentence.toLowerCase();
    if (!deduped.some((s) => s.toLowerCase().includes(normalized.slice(0, 40)))) {
      deduped.push(sentence);
    }
  }

  const prefix = title ? `${title}. ` : "";
  const text = `${prefix}${deduped.join(" ")}`.trim().slice(0, 1200);
  const qualityScore = Math.min(
    1,
    Math.max(0.55, deduped.length / 5 + (sections.length > 0 ? 0.2 : 0)),
  );

  return {
    text,
    method: "deterministic-section-aware",
    qualityScore: Number(qualityScore.toFixed(2)),
  };
}

function detectFormat(contentType: string | null, sourceRef: string, formatHint?: string): string {
  const hint = (formatHint ?? "").toLowerCase();
  if (hint) {
    return hint;
  }

  const normalizedType = (contentType ?? "").toLowerCase();
  if (normalizedType.includes("application/pdf")) return "pdf";
  if (normalizedType.includes("wordprocessingml.document")) return "docx";
  if (normalizedType.includes("text/html")) return "html";
  if (normalizedType.includes("text/markdown")) return "markdown";
  if (normalizedType.includes("text/csv")) return "csv";
  if (normalizedType.includes("tab-separated-values")) return "tsv";
  if (normalizedType.includes("text/plain")) return "txt";

  const ext = path.extname(sourceRef).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md") return "markdown";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv") return "tsv";
  return "txt";
}

function parseDelimited(text: string, delimiter: string): string {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  const rows = lines.slice(0, 50).map((line) => line.split(delimiter).map((c) => c.trim()));
  const headers = rows[0];
  const body = rows.slice(1, 6);
  const preview = body
    .map((row) => headers.map((h, i) => `${h}: ${row[i] ?? ""}`).join(", "))
    .join("\n");
  return `${headers.join(", ")}\n${preview}`.trim();
}

function parseHtml(html: string): { title: string; text: string; sections: Section[] } {
  const title = extractTitleFromHtml(html);
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const sections: Section[] = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    const level = Number(match[1]);
    const heading = htmlToText(match[2]);
    if (heading) {
      sections.push({ heading, level, content: "" });
    }
  }

  return { title, text: htmlToText(html), sections: sections.slice(0, 20) };
}

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) {
    return {};
  }
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key || typeof value !== "string") {
      continue;
    }
    if (/^(host|content-length)$/i.test(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function isPdfEncrypted(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString("latin1");
  return /\/Encrypt\b/.test(sample);
}

async function fetchRemoteContent(
  input: ReadDocumentInput,
): Promise<
  | { buffer: Buffer; contentType: string | null; finalUrl: string }
  | { error: string; errorCode: string }
> {
  const validation = validateTargetUrl(input.url || "");
  if (!validation.ok) {
    return { error: validation.message, errorCode: validation.errorCode };
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = input.url as string;
    let response: Response | null = null;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const currentValidation = validateTargetUrl(currentUrl);
      if (!currentValidation.ok) {
        return { error: currentValidation.message, errorCode: currentValidation.errorCode };
      }

      const reqHeaders = sanitizeHeaders(input.headers);
      if (input.cookies) {
        reqHeaders.Cookie = input.cookies;
      }

      response = await fetch(currentUrl, {
        method: "GET",
        headers: reqHeaders,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          break;
        }
        currentUrl = new URL(location, currentUrl).toString();

        if (redirectCount === MAX_REDIRECTS) {
          return {
            error: `Redirect limit exceeded (${MAX_REDIRECTS}).`,
            errorCode: "EXECUTION_FAILED",
          };
        }
        continue;
      }

      break;
    }

    if (!response) {
      return { error: "No response received", errorCode: "EXECUTION_FAILED" };
    }

    const contentType = response.headers.get("content-type");
    if (!isAllowedContentType(contentType)) {
      return {
        error: `Unsupported content type: ${contentType}`,
        errorCode: "POLICY_BLOCKED",
      };
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_BYTES) {
      return {
        error: `Response exceeds maximum allowed size (${MAX_CONTENT_BYTES} bytes).`,
        errorCode: "POLICY_BLOCKED",
      };
    }

    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > MAX_CONTENT_BYTES) {
      return {
        error: `Response exceeds maximum allowed size (${MAX_CONTENT_BYTES} bytes).`,
        errorCode: "POLICY_BLOCKED",
      };
    }

    return { buffer: raw, contentType, finalUrl: response.url || currentUrl };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      errorCode: "EXECUTION_FAILED",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readLocalContent(
  input: ReadDocumentInput,
): Promise<
  | { buffer: Buffer; contentType: string | null; finalPath: string }
  | { error: string; errorCode: string }
> {
  const workspaceRoot = getWorkspaceRoot();
  const sourcePath = input.filePath || "";

  const pathValidation = validatePath(sourcePath, workspaceRoot);
  if (!pathValidation.valid) {
    return { error: pathValidation.error || "Invalid path", errorCode: "POLICY_BLOCKED" };
  }

  const absolute = path.resolve(workspaceRoot, sourcePath);
  const blocked = isBlockedPath(absolute);
  if (blocked.blocked) {
    return { error: blocked.reason || "Blocked path", errorCode: "POLICY_BLOCKED" };
  }

  try {
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      return { error: "filePath must point to a regular file.", errorCode: "INVALID_INPUT" };
    }
    if (stats.size > MAX_CONTENT_BYTES) {
      return {
        error: `File exceeds maximum allowed size (${MAX_CONTENT_BYTES} bytes).`,
        errorCode: "POLICY_BLOCKED",
      };
    }

    const buffer = await fs.readFile(absolute);
    return { buffer, contentType: null, finalPath: absolute };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      errorCode: "NOT_FOUND",
    };
  }
}

async function parseByFormat(
  format: string,
  buffer: Buffer,
  htmlUrlOrPath: string,
  input: ReadDocumentInput,
): Promise<{
  title: string;
  content: string;
  sections: Section[];
  isEncrypted: boolean;
  encryptionType?: string;
  encryptionStatusCode?: string;
  encryptionUserMessage?: string;
  error?: string;
  errorCode?: string;
}> {
  if (format === "pdf") {
    const encrypted = isPdfEncrypted(buffer);
    const premiumMode = input.profile === "premium";

    if (encrypted && (!premiumMode || !input.pdfPassword)) {
      return {
        title: path.basename(htmlUrlOrPath),
        content: "",
        sections: [],
        isEncrypted: true,
        encryptionType: "password-protected",
        encryptionStatusCode: "PDF_ENCRYPTED",
        encryptionUserMessage:
          "This PDF appears encrypted. Provide a password in premium mode to read it.",
        error: "Encrypted PDF detected",
        errorCode: "POLICY_BLOCKED",
      };
    }

    try {
      const pdfParse = require("pdf-parse") as (
        buffer: Buffer,
        options?: Record<string, unknown>,
      ) => Promise<{ text: string; info?: { Title?: string } }>;
      const parsed = await pdfParse(
        buffer,
        premiumMode && input.pdfPassword ? { password: input.pdfPassword } : undefined,
      );
      const content = parsed.text?.replace(/\s+/g, " ").trim() ?? "";
      const sections = inferSectionsFromText(content);
      return {
        title: parsed.info?.Title || path.basename(htmlUrlOrPath),
        content,
        sections,
        isEncrypted: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const maybeEncrypted = /password|encrypted|decrypt/i.test(message);
      if (maybeEncrypted) {
        return {
          title: path.basename(htmlUrlOrPath),
          content: "",
          sections: [],
          isEncrypted: true,
          encryptionType: "password-protected",
          encryptionStatusCode: premiumMode ? "PDF_INVALID_PASSWORD" : "PDF_ENCRYPTED",
          encryptionUserMessage: premiumMode
            ? "Unable to open PDF with provided password."
            : "This PDF appears encrypted.",
          error: message,
          errorCode: "POLICY_BLOCKED",
        };
      }

      return {
        title: path.basename(htmlUrlOrPath),
        content: "",
        sections: [],
        isEncrypted: false,
        error: message,
        errorCode: "EXECUTION_FAILED",
      };
    }
  }

  if (format === "docx") {
    const parsed = await mammoth.extractRawText({ buffer });
    const content = (parsed.value ?? "").replace(/\s+/g, " ").trim();
    return {
      title: path.basename(htmlUrlOrPath),
      content,
      sections: inferSectionsFromText(content),
      isEncrypted: false,
    };
  }

  const text = buffer.toString("utf8");
  if (format === "html") {
    const parsed = parseHtml(text);
    return {
      title: parsed.title || path.basename(htmlUrlOrPath),
      content: parsed.text,
      sections: parsed.sections,
      isEncrypted: false,
    };
  }

  if (format === "csv") {
    const content = parseDelimited(text, ",");
    return {
      title: path.basename(htmlUrlOrPath),
      content,
      sections: inferSectionsFromText(content),
      isEncrypted: false,
    };
  }

  if (format === "tsv") {
    const content = parseDelimited(text, "\t");
    return {
      title: path.basename(htmlUrlOrPath),
      content,
      sections: inferSectionsFromText(content),
      isEncrypted: false,
    };
  }

  if (format === "markdown" || format === "md") {
    return {
      title: path.basename(htmlUrlOrPath),
      content: text,
      sections: inferSectionsFromText(text),
      isEncrypted: false,
    };
  }

  return {
    title: path.basename(htmlUrlOrPath),
    content: text,
    sections: inferSectionsFromText(text),
    isEncrypted: false,
  };
}

export async function readDocument(input: ReadDocumentInput): Promise<DocumentReadResult> {
  const maxChars = clampMaxChars(input.maxContentChars);

  if (!input.url && !input.filePath) {
    return {
      success: false,
      source: "local",
      sourceRef: "",
      format: "unknown",
      title: "",
      content: "",
      contentLength: 0,
      sections: [],
      description: {
        text: "",
        method: "deterministic-section-aware",
        qualityScore: 0,
      },
      isEncrypted: false,
      error: "Either url or filePath is required.",
      errorCode: "INVALID_INPUT",
    };
  }

  const source = input.url ? "remote" : "local";
  const sourceRef = input.url || input.filePath || "";

  const contentResult = input.url ? await fetchRemoteContent(input) : await readLocalContent(input);

  if ("error" in contentResult) {
    return {
      success: false,
      source,
      sourceRef,
      format: "unknown",
      title: "",
      content: "",
      contentLength: 0,
      sections: [],
      description: {
        text: "",
        method: "deterministic-section-aware",
        qualityScore: 0,
      },
      isEncrypted: false,
      error: contentResult.error,
      errorCode: contentResult.errorCode,
    };
  }

  const finalRef = "finalUrl" in contentResult ? contentResult.finalUrl : contentResult.finalPath;
  const format = detectFormat(contentResult.contentType, finalRef, input.formatHint);
  const parsed = await parseByFormat(format, contentResult.buffer, finalRef, input);

  if (parsed.error && parsed.errorCode) {
    return {
      success: false,
      source,
      sourceRef: finalRef,
      format,
      title: parsed.title,
      content: "",
      contentLength: 0,
      sections: [],
      description: {
        text: parsed.encryptionUserMessage || "",
        method: "deterministic-section-aware",
        qualityScore: 0,
      },
      isEncrypted: parsed.isEncrypted,
      encryptionType: parsed.encryptionType,
      encryptionStatusCode: parsed.encryptionStatusCode,
      encryptionUserMessage: parsed.encryptionUserMessage,
      error: parsed.error,
      errorCode: parsed.errorCode,
    };
  }

  const content = parsed.content.slice(0, maxChars);
  const sections = parsed.sections.length > 0 ? parsed.sections : inferSectionsFromText(content);
  const description = buildDescription(parsed.title, sections, content);

  return {
    success: true,
    source,
    sourceRef: finalRef,
    format,
    title: parsed.title,
    content,
    contentLength: content.length,
    sections,
    description,
    isEncrypted: false,
  };
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const hrefRegex = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (/^https?:\/\//i.test(url)) {
        links.add(url);
      }
    } catch {
      // skip malformed URLs
    }
  }

  return [...links];
}

export async function crawlDocuments(input: CrawlDocumentsInput): Promise<CrawlResult> {
  const depth = clampDepth(input.depth);
  const maxPages = clampMaxPages(input.maxPages);
  const sameOriginOnly = input.sameOriginOnly ?? true;

  const rootValidation = validateTargetUrl(input.url);
  if (!rootValidation.ok) {
    return {
      success: false,
      rootUrl: input.url,
      pagesVisited: 0,
      maxPages,
      depth,
      results: [],
      errors: [rootValidation.message],
    };
  }

  const rootOrigin = new URL(input.url).origin;
  const queue: Array<{ url: string; level: number }> = [{ url: input.url, level: 0 }];
  const visited = new Set<string>();
  const results: DocumentReadResult[] = [];
  const errors: string[] = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const current = queue.shift() as { url: string; level: number };
    if (visited.has(current.url)) {
      continue;
    }
    visited.add(current.url);

    const result = await readDocument({
      url: current.url,
      headers: input.headers,
      cookies: input.cookies,
      timeoutMs: input.timeoutMs,
      maxContentChars: input.maxContentChars,
    });

    results.push(result);
    if (!result.success) {
      errors.push(`${current.url}: ${result.error || "unknown error"}`);
      continue;
    }

    if (current.level >= depth || result.format !== "html") {
      continue;
    }

    const links = extractLinks(result.content, current.url);
    for (const link of links) {
      if (visited.has(link)) {
        continue;
      }
      if (sameOriginOnly && new URL(link).origin !== rootOrigin) {
        continue;
      }
      if (queue.length + visited.size >= maxPages) {
        break;
      }
      queue.push({ url: link, level: current.level + 1 });
    }
  }

  return {
    success: errors.length === 0,
    rootUrl: input.url,
    pagesVisited: visited.size,
    maxPages,
    depth,
    results,
    errors,
  };
}
