/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_api_lookup orchestration tool.
 * Provides cached Blender API documentation lookup with
 * token-based search support.
 *
 * Requirement 8: API Documentation Cache
 */

import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { DocCache } from "../doc-cache";
import { ApiLookupResult, BlenderBridgeConfig, DocCacheEntry } from "../types";

export interface ToolResult {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (input: unknown) => Promise<ToolResult>;
}

/**
 * Creates the blender_api_lookup tool handler.
 * Supports exact identifier lookup and token-based search,
 * with local disk caching for offline availability.
 */
export function createApiLookupTool(
  config: BlenderBridgeConfig,
  client: BlenderClient,
  docCache: DocCache,
): ToolHandler {
  const fetchTimeoutMs = config.docFetchTimeoutMs ?? 10000;

  return {
    name: "blender_api_lookup",
    description:
      "Looks up Blender API documentation by exact identifier or searches " +
      "cached documentation using token-based matching. Returns up to 20 results.",
    inputSchema: z.object({
      identifier: z
        .string()
        .optional()
        .describe("Exact API identifier to look up (e.g. 'bpy.types.Object')"),
      query: z
        .string()
        .optional()
        .describe("Search query for token-based search across cached documentation"),
    }),
    handler: async (input: unknown): Promise<ToolResult> => {
      const params = (input || {}) as { identifier?: string; query?: string };

      if (!params.identifier && !params.query) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: {
                    code: "INVALID_INPUT",
                    message: "Either 'identifier' or 'query' must be provided",
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Search mode
      if (params.query && !params.identifier) {
        const results = docCache.search(params.query, 20);
        const lookupResult: ApiLookupResult = {
          success: true,
          source: "cache",
          results: results.map((entry) => ({
            identifier: entry.identifier,
            content: entry.content,
          })),
        };

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(lookupResult, null, 2),
            },
          ],
        };
      }

      // Exact lookup mode
      const identifier = params.identifier!;

      // Check cache first
      const cached = docCache.get(identifier);
      if (cached) {
        const lookupResult: ApiLookupResult = {
          success: true,
          source: "cache",
          results: [{ identifier: cached.identifier, content: cached.content }],
        };

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(lookupResult, null, 2),
            },
          ],
        };
      }

      // Cache miss — fetch from upstream (Blender MCP's get_python_api_docs tool)
      try {
        const upstreamResult = await client.callTool("get_python_api_docs", {
          identifier,
        });

        if (upstreamResult.isError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: {
                      code: "UPSTREAM_ERROR",
                      message: "Documentation fetch failed from Blender MCP server",
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Extract content from upstream response
        const textContent = upstreamResult.content.find((c) => c.type === "text");
        const content = textContent && "text" in textContent ? textContent.text : "";

        // Store in cache
        const entry: DocCacheEntry = {
          identifier,
          content,
          fetchedAt: Date.now(),
          blenderVersion: "unknown",
        };
        docCache.put(entry);

        const lookupResult: ApiLookupResult = {
          success: true,
          source: "upstream",
          results: [{ identifier, content }],
        };

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(lookupResult, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes("timed out") || message.includes("timeout");

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: {
                    code: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
                    message: isTimeout
                      ? `Documentation fetch timed out after ${fetchTimeoutMs}ms`
                      : "Blender MCP server is unreachable. Verify Blender connectivity.",
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  };
}
