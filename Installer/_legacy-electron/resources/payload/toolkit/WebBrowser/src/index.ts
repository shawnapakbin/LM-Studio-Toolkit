import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { type BrowseInput, browseWeb } from "./browser";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3334);
const DEFAULT_TIMEOUT_MS = Number(process.env.BROWSER_DEFAULT_TIMEOUT_MS ?? 20000);
const MAX_TIMEOUT_MS = Number(process.env.BROWSER_MAX_TIMEOUT_MS ?? 60000);
const MAX_CONTENT_CHARS = Number(process.env.BROWSER_MAX_CONTENT_CHARS ?? 12000);

type BrowseRequest = Partial<BrowseInput>;

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-web-browser-tool", version: "2.1.0" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "browse_web",
    description:
      "Fetches a web page using headless Chromium and returns title and extracted content. Supports JS-rendered pages, SPAs, cookies, screenshots, and markdown output.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to fetch (http/https only)." },
        timeoutMs: { type: "number", description: "Request timeout in milliseconds." },
        maxContentChars: {
          type: "number",
          description: "Maximum returned content length in characters.",
        },
        waitForSelector: {
          type: "string",
          description: "CSS selector to wait for before extracting content.",
        },
        waitForNetworkIdle: {
          type: "boolean",
          description: "Wait for network idle before extracting.",
        },
        screenshot: {
          type: "boolean",
          description: "Capture a screenshot and return as base64 PNG.",
        },
        cookies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" },
              domain: { type: "string" },
            },
          },
          description: "Cookies to inject before navigation.",
        },
        outputFormat: {
          type: "string",
          enum: ["text", "markdown"],
          description: "Content format: 'text' or 'markdown'.",
        },
      },
      required: ["url"],
    },
  });
});

app.post(
  "/tools/browse_web",
  async (req: Request<unknown, unknown, BrowseRequest>, res: Response) => {
    const url = req.body.url?.trim();

    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).json({
        success: false,
        errorCode: "INVALID_INPUT",
        error: "'url' is required and must start with http:// or https://",
      });
      return;
    }

    const timeoutMs = (() => {
      const v = Number(req.body.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return Number.isFinite(v) ? Math.min(Math.max(v, 1), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    })();

    const maxContentChars = (() => {
      const v = Number(req.body.maxContentChars ?? MAX_CONTENT_CHARS);
      return Number.isFinite(v) ? Math.min(Math.max(v, 200), MAX_CONTENT_CHARS) : MAX_CONTENT_CHARS;
    })();

    const result = await browseWeb({
      url,
      timeoutMs,
      maxContentChars,
      waitForSelector: req.body.waitForSelector,
      waitForNetworkIdle: req.body.waitForNetworkIdle,
      screenshot: req.body.screenshot,
      cookies: req.body.cookies,
      outputFormat: req.body.outputFormat,
    });

    const status = result.success ? 200 : result.errorCode === "POLICY_BLOCKED" ? 403 : 400;
    res.status(status).json(result);
  },
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio Web Browser Tool listening on http://localhost:${PORT}`);
  });
}

export { app };
