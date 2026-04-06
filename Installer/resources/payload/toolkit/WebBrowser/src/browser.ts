import { type Browser, type Page, chromium } from "playwright";
import { extractContent } from "./extract-content";
import { isAllowedContentType, validateTargetUrl } from "./policy";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CookieDef {
  name: string;
  value: string;
  domain: string;
}

export interface BrowseInput {
  url: string;
  timeoutMs: number;
  maxContentChars: number;
  // v2.1.0 additions
  waitForSelector?: string;
  waitForNetworkIdle?: boolean;
  screenshot?: boolean;
  cookies?: CookieDef[];
  outputFormat?: "text" | "markdown";
}

export interface BrowseResult {
  success: boolean;
  status: number;
  finalUrl: string;
  title: string;
  content: string;
  contentLength: number;
  screenshotBase64?: string;
  error?: string;
  errorCode?: string;
}

// ─── BrowserPool ──────────────────────────────────────────────────────────────

let browser: Browser | null = null;
let pendingLaunch: Promise<Browser> | null = null;
let shutdownRegistered = false;

async function getPage(): Promise<Page> {
  // Re-launch if browser disconnected
  if (browser && !browser.isConnected()) {
    browser = null;
    pendingLaunch = null;
  }

  if (!browser) {
    if (!pendingLaunch) {
      const headless = process.env.BROWSER_HEADLESS !== "false";
      const executablePath = process.env.BROWSER_EXECUTABLE_PATH || undefined;
      pendingLaunch = chromium.launch({ headless, executablePath });
      try {
        browser = await pendingLaunch;
      } finally {
        pendingLaunch = null;
      }
    } else {
      // Another concurrent call is already launching — wait for it
      await pendingLaunch;
    }
  }

  if (!shutdownRegistered) {
    shutdownRegistered = true;
    const shutdown = async () => {
      if (browser) {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
        browser = null;
      }
    };
    process.once("exit", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown().then(() => process.exit(0));
    });
    process.once("SIGINT", () => {
      void shutdown().then(() => process.exit(0));
    });
  }

  return (browser as Browser).newPage();
}

export async function shutdownBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ─── browseWeb ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = Number(process.env.BROWSER_DEFAULT_TIMEOUT_MS ?? 20000);
const MAX_TIMEOUT_MS = Number(process.env.BROWSER_MAX_TIMEOUT_MS ?? 60000);
const MAX_CONTENT_CHARS = Number(process.env.BROWSER_MAX_CONTENT_CHARS ?? 12000);

export async function browseWeb(input: BrowseInput): Promise<BrowseResult> {
  // Phase 1: SSRF policy check — before any Playwright call
  const validation = validateTargetUrl(input.url);
  if (!validation.ok) {
    return {
      success: false,
      status: 0,
      finalUrl: input.url,
      title: "",
      content: "",
      contentLength: 0,
      error: validation.message,
      errorCode: validation.errorCode,
    };
  }

  const effectiveTimeout = Number.isFinite(input.timeoutMs)
    ? Math.min(Math.max(input.timeoutMs, 1), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  const effectiveMaxChars = Number.isFinite(input.maxContentChars)
    ? Math.min(Math.max(input.maxContentChars, 200), MAX_CONTENT_CHARS)
    : MAX_CONTENT_CHARS;

  // Phase 2: Acquire page from pool
  let page: Page;
  try {
    page = await getPage();
  } catch (err) {
    return {
      success: false,
      status: 0,
      finalUrl: input.url,
      title: "",
      content: "",
      contentLength: 0,
      error: err instanceof Error ? err.message : String(err),
      errorCode: "EXECUTION_FAILED",
    };
  }

  try {
    // Phase 3: Inject cookies
    if (input.cookies && input.cookies.length > 0) {
      await page.context().addCookies(input.cookies);
    }

    // Phase 4: Navigate
    const waitUntil = input.waitForNetworkIdle ? "networkidle" : "domcontentloaded";
    const response = await page.goto(input.url, {
      waitUntil,
      timeout: effectiveTimeout,
    });

    if (!response) {
      return {
        success: false,
        status: 0,
        finalUrl: input.url,
        title: "",
        content: "",
        contentLength: 0,
        error: "No response received.",
        errorCode: "EXECUTION_FAILED",
      };
    }

    // Phase 5: Content-type guard
    const contentType = response.headers()["content-type"] ?? null;
    if (!isAllowedContentType(contentType)) {
      return {
        success: false,
        status: response.status(),
        finalUrl: page.url(),
        title: "",
        content: "",
        contentLength: 0,
        error: `Unsupported content type: ${contentType}`,
        errorCode: "POLICY_BLOCKED",
      };
    }

    // Phase 6: Optional selector wait
    if (input.waitForSelector) {
      await page.waitForSelector(input.waitForSelector, { timeout: effectiveTimeout });
    }

    // Phase 7: Extract content from live DOM
    const outputFormat = input.outputFormat ?? "text";
    const { title, content } = await page.evaluate(extractContent, outputFormat);
    const truncated = content.slice(0, effectiveMaxChars);

    // Phase 8: Optional screenshot
    let screenshotBase64: string | undefined;
    if (input.screenshot) {
      try {
        const buf = await page.screenshot({ type: "png", fullPage: false });
        screenshotBase64 = buf.toString("base64");
      } catch {
        // screenshot failure is non-fatal
      }
    }

    return {
      success: response.status() < 400,
      status: response.status(),
      finalUrl: page.url(),
      title,
      content: truncated,
      contentLength: truncated.length,
      ...(screenshotBase64 !== undefined ? { screenshotBase64 } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = message.toLowerCase().includes("timeout") ? "TIMEOUT" : "EXECUTION_FAILED";
    return {
      success: false,
      status: 0,
      finalUrl: input.url,
      title: "",
      content: "",
      contentLength: 0,
      error: message,
      errorCode,
    };
  } finally {
    // Always close the page
    try {
      await page.close();
    } catch {
      /* ignore */
    }
  }
}
