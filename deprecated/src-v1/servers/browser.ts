import { z } from "zod";
import { chromium } from "playwright";
import { load as cheerioLoad } from "cheerio";
import { startServer } from "../shared/mcp-helpers.js";

const fetchPageArgs = z.object({
  url: z.string().url(),
  maxChars: z.number().int().positive().max(20000).optional().default(4000)
});

const linksArgs = z.object({
  url: z.string().url(),
  maxLinks: z.number().int().positive().max(200).optional().default(30)
});

const fetchPageRenderedArgs = z.object({
  url: z.string().url(),
  maxChars: z.number().int().positive().max(20000).optional().default(4000),
  waitForSelector: z.string().optional()
});

const extractMetadataArgs = z.object({
  url: z.string().url()
});

const extractTableArgs = z.object({
  url: z.string().url(),
  tableIndex: z.number().int().nonnegative().optional().default(0)
});

const extractDynamicLinksArgs = z.object({
  url: z.string().url(),
  maxLinks: z.number().int().positive().max(200).optional().default(30)
});

const fetchWithPaginationArgs = z.object({
  url: z.string().url(),
  paginationSelector: z.string().optional(),
  maxPages: z.number().int().positive().max(20).optional().default(5),
  maxChars: z.number().int().positive().max(50000).optional().default(20000)
});

const extractMainContentArgs = z.object({
  url: z.string().url(),
  maxChars: z.number().int().positive().max(20000).optional().default(4000)
});

const INSECURE_TLS = process.env.MCP_INSECURE_TLS === "1";

if (INSECURE_TLS) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTlsError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("certificate") ||
    message.includes("ssl") ||
    message.includes("tls") ||
    message.includes("unable to get local issuer")
  );
}

function buildNetworkMessage(error: unknown): string {
  const base = "Direct HTTPS fetch failed.";
  if (isTlsError(error)) {
    return `${base} Host TLS certificate trust is broken. Install/update CA trust on host or set MCP_INSECURE_TLS=1 temporarily.`;
  }
  return `${base} Error: ${getErrorMessage(error)}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#8212;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "local-mcp-toolkit/0.1.0" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRenderedHtml(url: string, waitForSelector?: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: INSECURE_TLS });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10000 });
    }
    return await page.content();
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function extractLinksFromHtml(html: string, maxLinks: number): string[] {
  const $ = cheerioLoad(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    if (links.size >= maxLinks) {
      return;
    }
    const href = $(el).attr("href");
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
      links.add(href);
    }
  });

  return [...links];
}

async function fetchAndExtractMetadata(url: string): Promise<Record<string, unknown>> {
  const html = await fetchRenderedHtml(url);
  const $ = cheerioLoad(html);

  const headings: string[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      headings.push(text);
    }
  });

  const schema: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const json = $(el).html();
      if (json) {
        schema.push(JSON.parse(json));
      }
    } catch {
      // Ignore invalid JSON snippets.
    }
  });

  return {
    title: $("title").text().trim(),
    description: $("meta[name='description']").attr("content") || "",
    canonical: $("link[rel='canonical']").attr("href") || "",
    lang: $("html").attr("lang") || "",
    headings,
    schema,
    links: extractLinksFromHtml(html, 50)
  };
}

async function fetchAndExtractMainContent(url: string): Promise<string> {
  const html = await fetchRenderedHtml(url);
  const $ = cheerioLoad(html);

  $("script,style,nav,footer,aside,.sidebar,.ads,.comments").remove();

  const main = $("main,article,.content,.entry-content,.post-content").first();
  const content = main.length > 0 ? main.html() || "" : $("body").html() || "";
  return stripHtml(content);
}

async function fetchAndExtractTable(url: string, tableIndex: number): Promise<string> {
  const html = await fetchRenderedHtml(url);
  const $ = cheerioLoad(html);
  const tables = $("table");

  if (tableIndex >= tables.length) {
    throw new Error(`Table index ${tableIndex} out of range (found ${tables.length} tables)`);
  }

  const table = tables.eq(tableIndex);
  const headers: string[] = [];
  table.find("thead th, thead td, tr:first th, tr:first td").each((_, el) => {
    headers.push($(el).text().trim().replace(/\s+/g, " "));
  });

  if (headers.length === 0) {
    throw new Error("Could not find table headers");
  }

  let markdown = `| ${headers.join(" | ")} |\n`;
  markdown += `| ${headers.map(() => "---").join(" | ")} |\n`;

  table.find("tbody tr").each((_, row) => {
    const cells: string[] = [];
    $(row).find("td").each((__, cell) => {
      cells.push($(cell).text().trim().replace(/\s+/g, " "));
    });
    if (cells.length === headers.length) {
      markdown += `| ${cells.join(" | ")} |\n`;
    }
  });

  return markdown;
}

async function fetchWithPagination(url: string, selector?: string, maxPages = 5): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: INSECURE_TLS });
  const page = await context.newPage();

  try {
    let currentUrl = url;
    let output = "";

    for (let i = 0; i < maxPages; i++) {
      await page.goto(currentUrl, { waitUntil: "networkidle", timeout: 45000 });
      output += `${stripHtml(await page.content())}\n\n---\n\n`;

      if (!selector) {
        break;
      }

      const next = await page.evaluate((sel) => {
        const node = document.querySelector(sel) as HTMLAnchorElement | null;
        return node?.href || "";
      }, selector);

      if (!next || next === currentUrl) {
        break;
      }
      currentUrl = next;
    }

    return output;
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await startServer("browser-mcp-server", "0.2.0", [
    {
      tool: {
        name: "fetch_page_text",
        description: "Fetch a web page and return cleaned text content.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            maxChars: { type: "number", minimum: 1, maximum: 20000 }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = fetchPageArgs.parse(args);
        try {
          const html = await fetchHtml(parsed.url);
          return `URL: ${parsed.url}\n\n${stripHtml(html).slice(0, parsed.maxChars)}`;
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "extract_links",
        description: "Extract HTTP(S) links from a web page.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            maxLinks: { type: "number", minimum: 1, maximum: 200 }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = linksArgs.parse(args);
        try {
          const html = await fetchHtml(parsed.url);
          return extractLinksFromHtml(html, parsed.maxLinks).join("\n") || "No absolute links found.";
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "fetch_page_rendered",
        description: "Fetch a web page with full JavaScript execution and return cleaned text content. Use for modern JS/TS-heavy websites (React, Vue, Angular, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            maxChars: { type: "number", minimum: 1, maximum: 20000 },
            waitForSelector: { type: "string" }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = fetchPageRenderedArgs.parse(args);
        try {
          const html = await fetchRenderedHtml(parsed.url, parsed.waitForSelector);
          return `URL: ${parsed.url}\n\n${stripHtml(html).slice(0, parsed.maxChars)}`;
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "extract_page_metadata",
        description: "Extract structured metadata from a web page (title, description, headings, schema.org data, links).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = extractMetadataArgs.parse(args);
        try {
          return JSON.stringify(await fetchAndExtractMetadata(parsed.url), null, 2);
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "extract_table_data",
        description: "Extract HTML table data and convert to markdown format.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            tableIndex: { type: "number", minimum: 0 }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = extractTableArgs.parse(args);
        try {
          return await fetchAndExtractTable(parsed.url, parsed.tableIndex);
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "extract_dynamic_links",
        description: "Extract all links from a page after JavaScript execution (includes dynamically generated links).",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            maxLinks: { type: "number", minimum: 1, maximum: 200 }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = extractDynamicLinksArgs.parse(args);
        try {
          const html = await fetchRenderedHtml(parsed.url);
          return extractLinksFromHtml(html, parsed.maxLinks).join("\n") || "No dynamic links found.";
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "fetch_with_pagination",
        description: "Fetch multiple pages from a paginated site and concatenate content.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            paginationSelector: { type: "string" },
            maxPages: { type: "number", minimum: 1, maximum: 20 },
            maxChars: { type: "number", minimum: 1, maximum: 50000 }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = fetchWithPaginationArgs.parse(args);
        try {
          const text = await fetchWithPagination(parsed.url, parsed.paginationSelector, parsed.maxPages);
          return `URL: ${parsed.url}\n\n${text.slice(0, parsed.maxChars)}`;
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    },
    {
      tool: {
        name: "extract_main_content",
        description: "Extract main article/content from a page, automatically removing navigation, sidebars, ads, and other non-content elements.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            maxChars: { type: "number", minimum: 1, maximum: 20000 }
          },
          required: ["url"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = extractMainContentArgs.parse(args);
        try {
          const text = await fetchAndExtractMainContent(parsed.url);
          return `URL: ${parsed.url}\n\n${text.slice(0, parsed.maxChars)}`;
        } catch (error) {
          throw new Error(buildNetworkMessage(error));
        }
      }
    }
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
