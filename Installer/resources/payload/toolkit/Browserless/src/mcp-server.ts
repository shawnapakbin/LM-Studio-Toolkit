import dotenv from "dotenv";

dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getAuthUrl, getRegionUrl } from "./utils";

const DEFAULT_REGION = process.env.BROWSERLESS_DEFAULT_REGION || "production-sfo";
const DEFAULT_TIMEOUT_MS = Number(process.env.BROWSERLESS_DEFAULT_TIMEOUT_MS ?? 30000);
const ENV_API_KEY = process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_API_TOKEN || "";

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

// ============================================================================
// Tool 1: browserless_smartscraper
// ============================================================================

const smartscraperInputSchema: Record<string, z.ZodTypeAny> = {
  url: z.string().min(1).describe("The URL to scrape (http or https)"),
  formats: z
    .array(z.enum(["markdown", "html", "screenshot", "pdf", "links"]))
    .optional()
    .default(["markdown"])
    .describe("Output formats: markdown, html, screenshot, pdf, links"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleSmartscraper(input: unknown): Promise<CallToolResult> {
  const {
    url,
    formats = ["markdown"],
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    url: string;
    formats?: string[];
    timeout?: number;
    apiKey?: string;
  };

  // URL goes in the JSON body per Browserless REST API spec
  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/smartscraper${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats }),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Tool 2: browserless_function
// ============================================================================

const functionInputSchema: Record<string, z.ZodTypeAny> = {
  code: z
    .string()
    .min(1)
    .describe(
      "JavaScript (ESM) code to execute. The default export receives { page, context } and should return { data, type }",
    ),
  context: z
    .record(z.unknown())
    .optional()
    .describe("Optional context object passed to the function"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleFunction(input: unknown): Promise<CallToolResult> {
  const {
    code,
    context,
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    code: string;
    context?: Record<string, unknown>;
    timeout?: number;
    apiKey?: string;
  };

  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/function${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, context }),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Tool 3: browserless_download
// ============================================================================

const downloadInputSchema: Record<string, z.ZodTypeAny> = {
  code: z
    .string()
    .min(1)
    .describe("JavaScript (ESM) code that triggers a file download in the browser"),
  context: z
    .record(z.unknown())
    .optional()
    .describe("Optional context object passed to the function"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleDownload(input: unknown): Promise<CallToolResult> {
  const {
    code,
    context,
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    code: string;
    context?: Record<string, unknown>;
    timeout?: number;
    apiKey?: string;
  };

  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/download${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, context }),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Tool 4: browserless_export
// ============================================================================

const exportInputSchema: Record<string, z.ZodTypeAny> = {
  url: z.string().min(1).describe("The URL to export (http or https)"),
  gotoOptions: z
    .record(z.unknown())
    .optional()
    .describe("Puppeteer Page.goto() options (waitUntil, timeout, referer)"),
  bestAttempt: z
    .boolean()
    .optional()
    .describe("When true, proceed even if awaited events fail or timeout"),
  includeResources: z
    .boolean()
    .optional()
    .describe("Bundle all linked resources (CSS, JS, images) into a ZIP file"),
  waitForTimeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Milliseconds to wait after page load before exporting"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleExport(input: unknown): Promise<CallToolResult> {
  const {
    url,
    gotoOptions,
    bestAttempt,
    includeResources,
    waitForTimeout,
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    url: string;
    gotoOptions?: Record<string, unknown>;
    bestAttempt?: boolean;
    includeResources?: boolean;
    waitForTimeout?: number;
    timeout?: number;
    apiKey?: string;
  };

  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/export${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const body: Record<string, unknown> = { url };
    if (gotoOptions) body.gotoOptions = gotoOptions;
    if (bestAttempt !== undefined) body.bestAttempt = bestAttempt;
    if (includeResources !== undefined) body.includeResources = includeResources;
    if (waitForTimeout !== undefined) body.waitForTimeout = waitForTimeout;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Tool 5: browserless_search
// ============================================================================

const searchInputSchema: Record<string, z.ZodTypeAny> = {
  query: z.string().min(1).describe("The search query string"),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10)
    .describe("Maximum number of results to return (capped by plan limits)"),
  lang: z.string().optional().default("en").describe("Language code for search results"),
  country: z.string().optional().describe("Country code for geo-targeted results"),
  location: z.string().optional().describe("Location string for geo-targeted results"),
  tbs: z.string().optional().describe("Time-based filter: day, week, month, year"),
  sources: z
    .array(z.enum(["web", "news", "images"]))
    .optional()
    .default(["web"])
    .describe("Search sources: web, news, images"),
  categories: z
    .array(z.string())
    .optional()
    .describe("Filter by categories: github, research, pdf"),
  scrapeOptions: z
    .object({
      formats: z.array(z.enum(["markdown", "html", "links", "screenshot"])).optional(),
      onlyMainContent: z.boolean().optional(),
      includeTags: z.array(z.string()).optional(),
      excludeTags: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Options for scraping each search result"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleSearch(input: unknown): Promise<CallToolResult> {
  const {
    query,
    limit = 10,
    lang = "en",
    country,
    location,
    tbs,
    sources = ["web"],
    categories,
    scrapeOptions,
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    query: string;
    limit?: number;
    lang?: string;
    country?: string;
    location?: string;
    tbs?: string;
    sources?: string[];
    categories?: string[];
    scrapeOptions?: Record<string, unknown>;
    timeout?: number;
    apiKey?: string;
  };

  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/search${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const body: Record<string, unknown> = { query, limit, lang, sources };
    if (country) body.country = country;
    if (location) body.location = location;
    if (tbs) body.tbs = tbs;
    if (categories) body.categories = categories;
    if (scrapeOptions) body.scrapeOptions = scrapeOptions;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Tool 6: browserless_map
// ============================================================================

const mapInputSchema: Record<string, z.ZodTypeAny> = {
  url: z.string().min(1).describe("The base URL to start mapping from (http or https)"),
  search: z.string().optional().describe("Search query to order results by relevance"),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe("Maximum number of links to return (max: 5000)"),
  sitemap: z
    .enum(["include", "skip", "only"])
    .optional()
    .default("include")
    .describe("Sitemap handling: include, skip, only"),
  includeSubdomains: z.boolean().optional().default(true).describe("Include URLs from subdomains"),
  ignoreQueryParameters: z
    .boolean()
    .optional()
    .default(true)
    .describe("Exclude URLs with query parameters"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleMap(input: unknown): Promise<CallToolResult> {
  const {
    url,
    search,
    limit = 100,
    sitemap = "include",
    includeSubdomains = true,
    ignoreQueryParameters = true,
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    url: string;
    search?: string;
    limit?: number;
    sitemap?: "include" | "skip" | "only";
    includeSubdomains?: boolean;
    ignoreQueryParameters?: boolean;
    timeout?: number;
    apiKey?: string;
  };

  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/map${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const body: Record<string, unknown> = {
      url,
      limit,
      sitemap,
      includeSubdomains,
      ignoreQueryParameters,
    };
    if (search) body.search = search;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Tool 7: browserless_bql (BrowserQL) - Recommended for dynamic content
// ============================================================================

const bqlInputSchema: Record<string, z.ZodTypeAny> = {
  query: z
    .string()
    .min(1)
    .describe(
      'BrowserQL GraphQL mutation string. MUST use mutation syntax. Example: mutation { goto(url: "https://example.com", waitUntil: domContentLoaded) { status } text { text } }. Do NOT use query{} syntax.',
    ),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30000)
    .describe("Request timeout in milliseconds"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Browserless API key. If omitted, falls back to BROWSERLESS_API_KEY environment variable",
    ),
};

async function handleBQL(input: unknown): Promise<CallToolResult> {
  const {
    query,
    timeout = DEFAULT_TIMEOUT_MS,
    apiKey,
  } = input as {
    query: string;
    timeout?: number;
    apiKey?: string;
  };

  const endpoint = `${getRegionUrl(DEFAULT_REGION)}/graphql${getAuthUrl(apiKey || ENV_API_KEY)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: getTimeoutSignal(timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, error: `HTTP ${response.status}: ${errorText}` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
      structuredContent: { success: true, data },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: errorMessage }, null, 2) },
      ],
    };
  }
}

// ============================================================================
// Initialize MCP Server
// ============================================================================

const server = new McpServer({
  name: "lm-studio-browserless-tool",
  version: "1.0.0",
});

const registerTool = server.registerTool.bind(server) as unknown as (
  name: string,
  config: { description: string; inputSchema: unknown },
  handler: (input: unknown) => Promise<CallToolResult>,
) => void;

// Register all 7 tools
registerTool(
  "browserless_smartscraper",
  {
    description: "Extracts structured content from a web page using Browserless SmartScraper.",
    inputSchema: smartscraperInputSchema,
  },
  handleSmartscraper,
);

registerTool(
  "browserless_function",
  {
    description: "Executes custom Puppeteer JavaScript code on the Browserless cloud.",
    inputSchema: functionInputSchema,
  },
  handleFunction,
);

registerTool(
  "browserless_download",
  {
    description:
      "Runs custom Puppeteer code and returns the file that Chrome downloads during execution.",
    inputSchema: downloadInputSchema,
  },
  handleDownload,
);

registerTool(
  "browserless_export",
  {
    description: "Exports a webpage by URL in its native format (HTML, PDF, image, etc.).",
    inputSchema: exportInputSchema,
  },
  handleExport,
);

registerTool(
  "browserless_search",
  {
    description: "Searches the web using Browserless and optionally scrapes each result.",
    inputSchema: searchInputSchema,
  },
  handleSearch,
);

registerTool(
  "browserless_map",
  {
    description: "Discovers and maps all URLs on a website using Browserless.",
    inputSchema: mapInputSchema,
  },
  handleMap,
);

registerTool(
  "browserless_bql",
  {
    description:
      "Execute BrowserQL queries for robust content extraction from dynamic sites. This is the recommended method for scraping modern websites with JavaScript-heavy content, as it provides more reliable and structured data than traditional Puppeteer-based approaches.",
    inputSchema: bqlInputSchema,
  },
  handleBQL,
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Browserless MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
