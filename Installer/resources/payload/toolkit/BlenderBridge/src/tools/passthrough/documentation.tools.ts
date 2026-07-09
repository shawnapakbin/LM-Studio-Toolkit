/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Documentation lookup passthrough tools.
 * These tools forward API documentation and manual search queries to the upstream
 * Blender MCP server, enabling lookup of Python API references and user manual content.
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import {
  connectionError,
  formatPassthroughResult,
  validateNumericRange,
  validateStringParam,
  validationError,
} from "./passthrough-helpers";

/**
 * Checks whether an upstream result represents an empty/not-found documentation response.
 * Returns true if the result has no meaningful content (empty text, "null", or empty array).
 */
function isEmptyDocResult(result: {
  isError: boolean;
  content: Array<{ type: string; text?: string }>;
}): boolean {
  if (result.isError) return false;
  if (result.content.length === 0) return true;

  const text = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  return text === "" || text === "null" || text === "[]";
}

/** Standard message returned when documentation is not found. */
const NO_DOCS_FOUND: ToolResult = {
  isError: false,
  content: [{ type: "text", text: "No documentation found for the given identifier." }],
};

const NO_SEARCH_RESULTS: ToolResult = {
  isError: false,
  content: [{ type: "text", text: "No documentation found for the given query." }],
};

/**
 * Creates the 3 documentation lookup passthrough tools:
 * - blender_api_docs: lookup Python API docs by identifier
 * - blender_search_api: full-text search over the Python API reference
 * - blender_search_manual: full-text search over the Blender user manual
 */
export function createDocumentationTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_api_docs",
      description:
        "Returns Blender Python API documentation for the specified identifier or discovery pattern (e.g., 'bpy.types.Scene' or 'bpy.*').",
      inputSchema: z.object({
        identifier: z
          .string()
          .describe("Fully-qualified Python API name or discovery pattern ending with '*'"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { identifier } = input as { identifier: string };
        const error = validateStringParam(identifier, "identifier", 256);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_python_api_docs", { identifier });
          if (isEmptyDocResult(result)) return NO_DOCS_FOUND;
          return formatPassthroughResult(result);
        } catch (e: unknown) {
          return connectionError(e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: "blender_search_api",
      description:
        "Full-text search over the Blender Python API reference documentation. Returns ranked results with file paths, matching text, and relevance scores.",
      inputSchema: z.object({
        query: z.string().describe("Search query text"),
        max_results: z
          .number()
          .optional()
          .describe("Maximum number of results to return (1-100, default 20)"),
        context: z
          .number()
          .optional()
          .describe("Number of surrounding paragraphs to include (0-10, default 0)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { query, max_results, context } = input as {
          query: string;
          max_results?: number;
          context?: number;
        };

        const queryError = validateStringParam(query, "query", 256);
        if (queryError) return validationError(queryError);

        if (max_results !== undefined) {
          const rangeError = validateNumericRange(max_results, "max_results", 1, 100);
          if (rangeError) return validationError(rangeError);
        }

        if (context !== undefined) {
          const rangeError = validateNumericRange(context, "context", 0, 10);
          if (rangeError) return validationError(rangeError);
        }

        try {
          const result = await client.callTool("search_api_docs", {
            query,
            max_results: max_results ?? 20,
            context: context ?? 0,
          });
          if (isEmptyDocResult(result)) return NO_SEARCH_RESULTS;
          return formatPassthroughResult(result);
        } catch (e: unknown) {
          return connectionError(e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: "blender_search_manual",
      description:
        "Full-text search over the Blender user manual documentation. Returns ranked results with file paths, matching text, and relevance scores.",
      inputSchema: z.object({
        query: z.string().describe("Search query text"),
        max_results: z
          .number()
          .optional()
          .describe("Maximum number of results to return (1-100, default 20)"),
        context: z
          .number()
          .optional()
          .describe("Number of surrounding paragraphs to include (0-10, default 0)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { query, max_results, context } = input as {
          query: string;
          max_results?: number;
          context?: number;
        };

        const queryError = validateStringParam(query, "query", 256);
        if (queryError) return validationError(queryError);

        if (max_results !== undefined) {
          const rangeError = validateNumericRange(max_results, "max_results", 1, 100);
          if (rangeError) return validationError(rangeError);
        }

        if (context !== undefined) {
          const rangeError = validateNumericRange(context, "context", 0, 10);
          if (rangeError) return validationError(rangeError);
        }

        try {
          const result = await client.callTool("search_manual_docs", {
            query,
            max_results: max_results ?? 20,
            context: context ?? 0,
          });
          if (isEmptyDocResult(result)) return NO_SEARCH_RESULTS;
          return formatPassthroughResult(result);
        } catch (e: unknown) {
          return connectionError(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];
}
