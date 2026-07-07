/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Enhanced HTTP Proxy Gateway for MCP Browser Tools
 * 
 * Runs outside LM Studio's sandbox to fetch web content on behalf of
 * sandboxed MCP servers. Supports both simple HTTP fetches and full
 * JavaScript rendering via Playwright.
 */

import { createServer } from "node:http";
import { Browser, Page, chromium } from "playwright";
import { load as cheerioLoad } from "cheerio";

const PORT = 8765;
const HOST = "127.0.0.1";
const INSECURE_TLS = process.env.MCP_INSECURE_TLS === "1";
const USE_PLAYWRIGHT = process.env.MCP_USE_PLAYWRIGHT === "1";

if (INSECURE_TLS) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Browser pool management
let browserPool: Browser | null = null;
let browserPagePool: Page[] = [];
const MAX_BROWSERS = 3;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

interface ProxyRequest {
  url: string;
  maxChars?: number;
  maxLinks?: number;
  extractLinks?: boolean;
  rendered?: boolean;
  metadata?: boolean;
  mainContent?: boolean;
  tableData?: boolean;
  dynamicLinks?: boolean;
  pagination?: {
    selector?: string;
    maxPages?: number;
  };
  screenshot?: boolean;
}

interface PageMetadata {
  title: string;
  description?: string;
  canonical?: string;
  lang?: string;
  headings: string[];
  mainText?: string;
  schema?: unknown[];
  links?: string[];
}

// Initialize browser pool
async function getBrowser(): Promise<Browser> {
  if (!browserPool) {
    console.log("[Playwright] Initializing browser pool...");
    browserPool = await chromium.launch({ headless: true });
  }
  return browserPool;
}

// Get a page from pool or create new one
async function getPage(): Promise<Page> {
  const browser = await getBrowser();
  let page = browserPagePool.pop();
  
  if (!page) {
    page = await browser.newPage();
    page.setDefaultTimeout(15000);
  }
  
  // Set idle timeout for cleanup
  setTimeout(() => {
    if (browserPagePool.includes(page)) {
      page!.close().catch(() => {});
      browserPagePool = browserPagePool.filter(p => p !== page);
    }
  }, IDLE_TIMEOUT);
  
  return page;
}

// Return page to pool
function returnPage(page: Page): void {
  if (browserPagePool.length < MAX_BROWSERS) {
    browserPagePool.push(page);
  } else {
    page.close().catch(() => {});
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<string> {
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
  } catch (error) {
    if (error instanceof Error) {
      const cause = (error as Error & { cause?: unknown }).cause;
      const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
      if (causeMessage) {
        throw new Error(`${error.message}: ${causeMessage}`);
      }
      throw error;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageRendered(url: string): Promise<string> {
  if (!USE_PLAYWRIGHT) {
    throw new Error("Playwright rendering not enabled. Set MCP_USE_PLAYWRIGHT=1");
  }

  const page = await getPage();
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    const content = await page.content();
    return stripHtml(content);
  } finally {
    returnPage(page);
  }
}

function extractLinks(html: string, maxLinks: number): string[] {
  const $ = cheerioLoad(html);
  const links = new Set<string>();
  
  $("a[href]").each((_, element) => {
    if (links.size >= maxLinks) return;
    const href = $(element).attr("href");
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
      links.add(href);
    }
  });

  return [...links];
}

function extractDynamicLinks(html: string, maxLinks: number): string[] {
  // After JS execution, all links are in the HTML
  return extractLinks(html, maxLinks);
}

async function extractPageMetadata(url: string, html?: string): Promise<PageMetadata> {
  if (!html) {
    html = await fetchPage(url);
  }

  const $ = cheerioLoad(html);
  
  const title = $("title").text() || $("meta[property='og:title']").attr("content") || "";
  const description = $("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || "";
  const canonical = $("link[rel='canonical']").attr("href") || "";
  const lang = $("html").attr("lang") || "";
  
  const headings: string[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const text = $(el).text().trim();
    if (text) headings.push(text);
  });

  // Extract main text (first paragraph or largest text block)
  const mainContent = $("main, article, .content, .post").first().text() || $("body").text();
  const mainText = stripHtml(mainContent).slice(0, 500);

  // Extract schema.org data
  const schema: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      schema.push(JSON.parse($(el).html() || "{}"));
    } catch {
      // Ignore invalid JSON
    }
  });

  const links = extractLinks(html, 20);

  return {
    title,
    description,
    canonical,
    lang,
    headings,
    mainText,
    schema: schema.length > 0 ? schema : undefined,
    links
  };
}

async function extractMainContent(url: string, html?: string): Promise<string> {
  if (!html) {
    html = await fetchPage(url);
  }

  const $ = cheerioLoad(html);
  
  // Remove common non-content elements
  $("script, style, nav, footer, .ads, .sidebar, .comments, .related, .footer").remove();
  
  // Try to find main content
  const main = $("main, article, .content, .post, .entry-content, .article-body").first();
  const content = main.length > 0 ? main.html() : $("body").html();
  
  return stripHtml(content || "");
}

async function extractTableData(url: string, tableIndex: number = 0, html?: string): Promise<string> {
  if (!html) {
    html = await fetchPage(url);
  }

  const $ = cheerioLoad(html);
  const tables = $("table");
  
  if (tableIndex >= tables.length) {
    throw new Error(`Table index ${tableIndex} out of range (found ${tables.length} tables)`);
  }

  const table = tables.eq(tableIndex);
  let markdownTable = "";
  
  // Extract headers
  const headers: string[] = [];
  table.find("thead th, thead td, tr:first th, tr:first td").each((_, el) => {
    headers.push($(el).text().trim().replace(/\n/g, " "));
  });

  if (headers.length === 0) {
    throw new Error("Could not find table headers");
  }

  markdownTable += "| " + headers.join(" | ") + " |\n";
  markdownTable += "|" + headers.map(() => " --- ").join("|") + "|\n";

  // Extract rows
  table.find("tbody tr, tr").each((_, row) => {
    const cells: string[] = [];
    $(row).find("td").each((_, cell) => {
      cells.push($(cell).text().trim().replace(/\n/g, " "));
    });
    if (cells.length === headers.length) {
      markdownTable += "| " + cells.join(" | ") + " |\n";
    }
  });

  return markdownTable;
}

async function fetchWithPagination(
  url: string,
  paginationSelector?: string,
  maxPages: number = 5
): Promise<string> {
  if (!USE_PLAYWRIGHT) {
    return stripHtml(await fetchPage(url));
  }

  const page = await getPage();
  let allContent = "";
  let currentUrl = url;

  try {
    for (let i = 0; i < maxPages; i++) {
      console.log(`[Pagination] Fetching page ${i + 1} from ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: "networkidle" });
      
      const content = await page.content();
      allContent += stripHtml(content) + "\n\n---\n\n";

      if (!paginationSelector) break;

      // Try to find next page link
      const nextUrl = await page.evaluate((selector: string) => {
        const nextLink = document.querySelector(selector) as HTMLAnchorElement;
        return nextLink?.href;
      }, paginationSelector);

      if (!nextUrl || nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }
  } finally {
    returnPage(page);
  }

  return allContent.slice(0, 50000); // Limit output
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const proxyReq: ProxyRequest = JSON.parse(body);

      if (!proxyReq.url || typeof proxyReq.url !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request: url required" }));
        return;
      }

      const url = proxyReq.url;
      console.log(`[${new Date().toISOString()}] Processing: ${url}`);

      // Route to appropriate handler
      if (proxyReq.metadata) {
        const metadata = await extractPageMetadata(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metadata));
      } else if (proxyReq.tableData) {
        const tableIndex = 0; // TODO: add to request
        const tableMarkdown = await extractTableData(url, tableIndex);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ table: tableMarkdown }));
      } else if (proxyReq.mainContent) {
        const content = await extractMainContent(url);
        const maxChars = proxyReq.maxChars ?? 20000;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: content.slice(0, maxChars) }));
      } else if (proxyReq.pagination) {
        const content = await fetchWithPagination(
          url,
          proxyReq.pagination.selector,
          proxyReq.pagination.maxPages ?? 5
        );
        const maxChars = proxyReq.maxChars ?? 50000;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: content.slice(0, maxChars) }));
      } else if (proxyReq.rendered) {
        if (!USE_PLAYWRIGHT) {
          throw new Error("Playwright rendering not enabled. Set MCP_USE_PLAYWRIGHT=1");
        }
        const content = await fetchPageRendered(url);
        const maxChars = proxyReq.maxChars ?? 20000;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: content.slice(0, maxChars) }));
      } else if (proxyReq.extractLinks) {
        const html = await fetchPage(url);
        const maxLinks = proxyReq.maxLinks ?? 30;
        const links = extractLinks(html, maxLinks);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ links }));
      } else if (proxyReq.dynamicLinks) {
        const maxLinks = proxyReq.maxLinks ?? 30;
        const html = USE_PLAYWRIGHT ? await fetchPageRendered(url) : await fetchPage(url);
        const links = extractDynamicLinks(html, maxLinks);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ links }));
      } else {
        // Default: simple fetch and strip HTML
        const html = await fetchPage(url);
        const maxChars = proxyReq.maxChars ?? 4000;
        const text = stripHtml(html).slice(0, maxChars);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text }));
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error:`, error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
    }
  });
});

async function cleanup() {
  console.log("[Shutdown] Closing browser pages...");
  for (const page of browserPagePool) {
    await page.close().catch(() => {});
  }
  browserPagePool = [];

  if (browserPool) {
    console.log("[Shutdown] Closing browser...");
    await browserPool.close().catch(() => {});
    browserPool = null;
  }
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

server.listen(PORT, HOST, () => {
  console.log(`🌐 MCP Enhanced Proxy Gateway running on http://${HOST}:${PORT}`);
  console.log(`   Keep this running while using LM Studio with browser tools.`);
  if (USE_PLAYWRIGHT) {
    console.log(`   ✅ JavaScript rendering enabled (Playwright)`);
  } else {
    console.log(`   ℹ️  JavaScript rendering disabled. Set MCP_USE_PLAYWRIGHT=1 to enable.`);
  }
  if (INSECURE_TLS) {
    console.warn("   ⚠️  MCP_INSECURE_TLS=1 is enabled; TLS certificate verification is disabled.");
  }
});

server.on("error", (error) => {
  console.error("Failed to start proxy server:", error);
  process.exit(1);
});
