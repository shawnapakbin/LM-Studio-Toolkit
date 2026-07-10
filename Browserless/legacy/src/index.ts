import express, { Request, Response } from "express";
import { z } from "zod";
import { MAX_CODE_LENGTH, hasUnsafeCodePatterns, isValidApiKey, validateTargetUrl } from "./policy";

const smartscraperSchema = z.object({
  url: z.string().url(),
  formats: z
    .array(z.enum(["markdown", "html", "screenshot", "pdf", "links"]))
    .optional()
    .default(["markdown"]),
  timeout: z.number().int().positive().optional().default(30000),
});

type SmartscraperParams = z.infer<typeof smartscraperSchema> & { apiKey?: string; region?: string };

const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (_req: Request, res: Response): void => {
  res.json({ status: "ok", service: "browserless-tool" });
});

// POST /content endpoint (dynamic docs guidance)
app.post("/content", async (req: Request, res: Response): Promise<void> => {
  const { apiKey, url } = req.body;

  if (!isValidApiKey(apiKey)) {
    res.status(500).json({ success: false, error: "Invalid API key" });
    return;
  }

  if (!url) {
    res.status(400).json({ success: false, error: "URL is required" });
    return;
  }

  const validation = validateTargetUrl(url);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.error });
    return;
  }

  // Check for known dynamic docs domains
  if (url.includes("browserless-docs.mcp.kapa.ai")) {
    res.json({
      success: false,
      error: "Dynamic documentation site detected. Use BrowserQL for robust content extraction.",
      guidance:
        'This site requires BrowserQL (browserless_bql) for reliable ingestion. Example: { query: "query { pageText(url: \\"https://browserless-docs.mcp.kapa.ai\\") { text } }" }',
      recommendedTool: "browserless_bql",
      url,
    });
    return;
  }

  res.json({ success: false, error: "Content endpoint not implemented" });
});

// Helper function to validate and process requests
function processRequest(req: Request, res: Response, _allowedPaths: string[]): void {
  const { apiKey, url } = req.body;

  if (!isValidApiKey(apiKey)) {
    res.status(500).json({ success: false, error: "Invalid API key" });
    return;
  }

  if (!url) {
    res.status(400).json({ success: false, error: "URL is required" });
    return;
  }

  const validation = validateTargetUrl(url);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.error });
    return;
  }

  res.json({ success: false, error: "Endpoint not implemented" });
}

// POST /screenshot endpoint
app.post("/screenshot", (req: Request, res: Response): void => {
  processRequest(req, res, ["/screenshot"]);
});

// POST /pdf endpoint
app.post("/pdf", (req: Request, res: Response): void => {
  processRequest(req, res, ["/pdf"]);
});

// POST /scrape endpoint
app.post("/scrape", (req: Request, res: Response): void => {
  processRequest(req, res, ["/scrape"]);
});

// POST /unblock endpoint
app.post("/unblock", (req: Request, res: Response): void => {
  const { apiKey, url } = req.body;

  if (!isValidApiKey(apiKey)) {
    res.status(500).json({ success: false, error: "Invalid API key" });
    return;
  }

  if (!url) {
    res.status(400).json({ success: false, error: "URL is required" });
    return;
  }

  const validation = validateTargetUrl(url);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.error });
    return;
  }

  res.json({ success: false, error: "Unblock endpoint not implemented" });
});

// POST /function endpoint
app.post("/function", (req: Request, res: Response): void => {
  const { apiKey, code } = req.body;

  if (!isValidApiKey(apiKey)) {
    res.status(500).json({ success: false, error: "Invalid API key" });
    return;
  }

  if (!code || typeof code !== "string") {
    res.status(400).json({ success: false, error: "Code is required and must be a string" });
    return;
  }

  if (isCodeTooLong(code)) {
    res.status(400).json({
      success: false,
      error: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters`,
    });
    return;
  }

  if (hasUnsafeCodePatterns(code)) {
    res.status(403).json({ success: false, error: "Code contains unsafe patterns" });
    return;
  }

  res.json({ success: false, error: "Function endpoint not implemented" });
});

// POST /export endpoint
app.post("/export", (req: Request, res: Response): void => {
  processRequest(req, res, ["/export"]);
});

// POST /performance endpoint
app.post("/performance", (req: Request, res: Response): void => {
  processRequest(req, res, ["/performance"]);
});

export { app, smartscraperHandler, smartscraperSchema };

async function smartscraperHandler(params: SmartscraperParams) {
  const { url, formats = ["markdown"], timeout = 30000, apiKey, region } = params;
  const endpoint = `${getRegionUrl(region)}/smartscraper`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(apiKey),
      },
      body: JSON.stringify({ url, formats }),
      signal: getTimeoutSignal(timeout),
    });
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${await response.text()}` };
    }
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

function getAuthHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
function getRegionUrl(region?: string): string {
  if (!region) return "https://production-sfo.browserless.io";
  if (region === "lon") return "https://production-lon.browserless.io";
  if (region === "ams") return "https://production-ams.browserless.io";
  return region;
}
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
function getTimeoutSignal(timeout: number): AbortSignal | undefined {
  if (typeof AbortController !== "undefined") {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    return controller.signal;
  }
  return undefined;
}

function isCodeTooLong(code: string): boolean {
  return code.length > MAX_CODE_LENGTH;
}
