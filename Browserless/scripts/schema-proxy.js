#!/usr/bin/env node
/**
 * Schema-patching MCP stdio proxy for @browserless.io/mcp.
 *
 * The official @browserless.io/mcp package exposes tool schemas that are
 * incompatible with llama.cpp's GBNF grammar generation (used by LM Studio):
 *   - Non-anchored regex `pattern` fields
 *   - Internal `$ref` pointers
 *   - Deeply nested anyOf discriminated unions (20+ variants)
 *   - Complex schema features that exceed grammar parser capabilities
 *
 * This proxy replaces tool inputSchemas with flat, grammar-safe equivalents
 * that preserve all the information the LLM needs to produce valid calls.
 * The real @browserless.io/mcp server still validates the actual payloads.
 *
 * Usage: { "command": "node", "args": ["Browserless/scripts/schema-proxy.js"] }
 */

"use strict";

const { spawn } = require("child_process");

// --- Launch the real MCP server (skip when loaded for testing) ---
if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== "test") {
  const child = spawn("npx", ["-y", "@browserless.io/mcp"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
    shell: true,
  });

  child.on("error", (err) => {
    process.stderr.write(`[schema-proxy] Failed to spawn child: ${err.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  process.stdin.pipe(child.stdin);

  // --- Intercept stdout ---
  let buffer = "";

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) {
        process.stdout.write("\n");
        continue;
      }
      process.stdout.write(patchLine(line.trim()) + "\n");
    }
  });

  child.stdout.on("end", () => {
    if (buffer.trim()) {
      process.stdout.write(patchLine(buffer.trim()) + "\n");
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
}

// --- Patching ---

function patchLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return line;
  }

  // Patch tools/list responses
  if (msg && msg.result && Array.isArray(msg.result.tools)) {
    for (const tool of msg.result.tools) {
      if (tool.inputSchema) {
        tool.inputSchema = getGrammarSafeSchema(tool.name, tool.inputSchema);
      }
    }
    return JSON.stringify(msg);
  }

  return line;
}

/**
 * Return a grammar-safe schema for a given tool.
 * Uses hardcoded safe schemas for known tools, falls back to
 * aggressive simplification for unknown ones.
 */
function getGrammarSafeSchema(toolName, original) {
  const override = SAFE_SCHEMAS[toolName];
  if (override) return override;

  // For unknown tools, do aggressive simplification
  return aggressiveSimplify(original);
}

/**
 * Aggressively simplify any schema to be grammar-safe.
 * Strips all complex constructs, keeps only basic type info.
 */
function aggressiveSimplify(schema) {
  if (!schema || typeof schema !== "object") return { type: "object" };

  const result = { type: "object" };
  if (schema.properties && typeof schema.properties === "object") {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = flattenProp(prop);
    }
    if (schema.required) result.required = schema.required;
  }
  return result;
}

function flattenProp(prop) {
  if (!prop || typeof prop !== "object") return { type: "string" };

  const simple = {};
  if (prop.type) simple.type = prop.type;
  else simple.type = "string";

  if (prop.description) simple.description = prop.description;
  if (prop.enum) simple.enum = prop.enum;

  // Arrays get simple items
  if (simple.type === "array") {
    simple.items = { type: "string" };
  }

  return simple;
}

// --- Grammar-safe schema overrides for each browserless tool ---

const SAFE_SCHEMAS = {
  browserless_agent: {
    type: "object",
    properties: {
      method: {
        type: "string",
        description:
          "BQL method to execute (goto, snapshot, click, type, select, checkbox, hover, scroll, evaluate, text, html, waitForSelector, waitForNavigation, waitForTimeout, waitForRequest, waitForResponse, liveURL, solve, screenshot, uploadFile, getDownloads, close, getTabs, switchTab, createTab, closeTab, back, forward, reload, loadSecret, saveProfile)",
      },
      params: {
        type: "object",
        description:
          "Parameters for the method. For goto: {url}. For click/type/select/hover/checkbox: {selector, text?, value?, checked?}. For waitForSelector: {selector, timeout?}. For evaluate: {content}. For screenshot: {type?, fullPage?, selector?, quality?}.",
      },
      commands: {
        type: "array",
        items: { type: "object" },
        description:
          "Optional: batch multiple commands. Each item: {method, params}. When provided, top-level method/params are ignored.",
      },
      rationale: {
        type: "string",
        description:
          "Short human-readable reason for this call (max 50 chars, present-continuous form e.g. 'Logging in')",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name to hydrate cookies/storage into the session",
      },
    },
    required: ["method"],
  },

  browserless_crawl: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The starting URL to crawl (http or https). WARNING: Root URLs (/) on documentation sites may redirect (e.g., to /docs/getting-started). Target specific paths rather than relying on root URL resolution.",
      },
      maxPages: {
        type: "number",
        description:
          "Maximum number of pages to crawl (default 10). NOTE: This is a soft cap — sitemap discovery may cause more pages to be returned than specified. For strict limits, post-process and truncate results.",
      },
      formats: {
        type: "array",
        items: { type: "string" },
        description:
          "Output formats: 'markdown', 'html', 'screenshot', 'links' (default ['markdown'])",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
    },
    required: ["url"],
  },

  browserless_smartscraper: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL to scrape (http or https). WARNING: Root URLs (/) on documentation sites may redirect (e.g., to /docs/getting-started). Target specific paths rather than relying on root URL resolution.",
      },
      formats: {
        type: "array",
        items: { type: "string" },
        description:
          "Output formats: 'markdown', 'html', 'screenshot', 'pdf', 'links' (default ['markdown'])",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
    },
    required: ["url"],
  },

  browserless_search: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query string",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of results to return. NOTE: The effective maximum depends on your API key tier (free tier max is 3). Values above your tier limit will be silently capped. Default: 3.",
      },
      lang: {
        type: "string",
        description: "Language code for search results (default 'en')",
      },
      country: {
        type: "string",
        description: "Country code for search results (e.g. 'us', 'gb')",
      },
      tbs: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "Time-based filter for results",
      },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "Search sources: 'web', 'news', 'images' (default ['web'])",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
    },
    required: ["query"],
  },

  browserless_export: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL to export (http or https). WARNING: Root URLs (/) on documentation sites may redirect (e.g., to /docs/getting-started). Target specific paths rather than relying on root URL resolution.",
      },
      format: {
        type: "string",
        enum: ["pdf", "png", "jpeg", "webp"],
        description: "Export format",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
      waitForSelector: {
        type: "string",
        description:
          "CSS selector to wait for before capturing export. Use for SPA/JavaScript-rendered pages that need time to render dynamic content.",
      },
      waitForTimeout: {
        type: "number",
        description:
          "Time in milliseconds to wait before capturing export. Use for pages with animations or delayed rendering.",
      },
    },
    required: ["url"],
  },

  browserless_function: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "JavaScript ESM code to execute. MUST use 'export default async function' syntax. IMPORTANT: The page starts on about:blank — your code MUST include 'await page.goto(url)' to navigate to a target page before interacting. The function receives { page, context } and must return { data, type }. Example: 'export default async function({ page }) { await page.goto(\"https://example.com\"); const title = await page.title(); return { data: title, type: \"text/plain\" }; }'",
      },
      context: {
        type: "object",
        description: "Optional context object passed to the function as the second argument",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
    },
    required: ["code"],
  },

  browserless_map: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL to generate a sitemap from. WARNING: Root URLs (/) on documentation sites may redirect (e.g., to /docs/getting-started). Target specific paths rather than relying on root URL resolution.",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
    },
    required: ["url"],
  },

  browserless_performance: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL to run a performance audit on. WARNING: Root URLs (/) on documentation sites may redirect (e.g., to /docs/getting-started). Target specific paths rather than relying on root URL resolution.",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
      profile: {
        type: "string",
        description: "Optional auth profile name",
      },
    },
    required: ["url"],
  },

  browserless_skill: {
    type: "object",
    properties: {
      id: {
        type: "string",
        enum: [
          "autonomous-login",
          "shadow-dom",
          "cookie-consent",
          "modals",
          "captchas",
          "snapshot-misses",
          "dynamic-content",
          "screenshots",
          "tabs",
          "auth-profile",
          "file-transfers",
        ],
        description:
          "The skill ID to load. Available skills: autonomous-login, shadow-dom, cookie-consent, modals, captchas, snapshot-misses, dynamic-content, screenshots, tabs, auth-profile, file-transfers",
      },
    },
    required: ["id"],
  },
};

// Test exports
if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
  module.exports = { SAFE_SCHEMAS, aggressiveSimplify };
}
