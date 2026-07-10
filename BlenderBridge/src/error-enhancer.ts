/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Error enhancement module for Blender execution errors.
 * Detects AttributeError, KeyError, and deprecated API patterns,
 * then enriches the error with actionable suggestions.
 *
 * Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6: Enhanced error messages
 */

import { findMigrationMapping } from "./api-compat";
import { findClosestMatches, similarityRatio } from "./blender-client";
import { BlenderExecutionError } from "./types";

/**
 * Type for a lightweight code execution function used to query Blender
 * for dir() or collection keys during error enhancement.
 */
type ExecuteCodeFn = (code: string) => Promise<string>;

/**
 * Enhances a BlenderExecutionError with actionable suggestions by:
 * 1. Detecting AttributeError → querying Blender for valid attributes
 * 2. Detecting KeyError → querying Blender for available collection items
 * 3. Detecting deprecated API patterns → cross-referencing the compat table
 *
 * This is a best-effort operation. If follow-up queries fail, the original
 * error is returned with a health-check suggestion.
 */
export async function enhanceError(
  error: BlenderExecutionError,
  executeCode: ExecuteCodeFn,
): Promise<BlenderExecutionError> {
  const enhanced = { ...error };
  const message = error.message || "";
  const traceback = error.traceback || "";
  const fullText = traceback || message;

  // 1. Detect AttributeError
  const attrError = parseAttributeError(fullText);
  if (attrError) {
    enhanced.invalidAttribute = attrError.attribute;
    enhanced.objectType = attrError.objectType;

    try {
      const dirResult = await queryDir(executeCode, attrError.expression);
      if (dirResult.length > 0) {
        const similar = rankBySimilarity(attrError.attribute, dirResult, 5);
        if (similar.length > 0) {
          enhanced.similarAttributes = similar;
        }
      }
    } catch {
      // Graceful degradation: fall back to health check suggestion
      if (!enhanced.suggestion) {
        enhanced.suggestion =
          "Could not retrieve attribute suggestions. Verify connectivity using the blender_health_check tool.";
      }
    }
  }

  // 2. Detect KeyError on collections
  const keyError = parseKeyError(fullText);
  if (keyError) {
    try {
      const items = await queryCollectionKeys(executeCode, keyError.collection);
      if (items !== null) {
        const totalCount = items.length;
        enhanced.collectionItems = items.slice(0, 10);
        if (totalCount > 10) {
          enhanced.collectionTotalCount = totalCount;
        }
      }
    } catch {
      if (!enhanced.suggestion) {
        enhanced.suggestion =
          "Could not retrieve collection items. Verify connectivity using the blender_health_check tool.";
      }
    }
  }

  // 3. Detect deprecated API patterns
  const migration = findMigrationMapping(fullText, [5, 0, 0]);
  if (migration) {
    enhanced.deprecatedApi = migration.deprecatedApi;
    enhanced.replacementApi = migration.replacementApi;
    enhanced.deprecationVersion = migration.introducedInVersion;
  }

  // 4. Detect BlendData attribute errors (Req 2.3)
  const blendDataError = parseBlendDataError(fullText);
  if (blendDataError) {
    const suggestion = getBlendDataSuggestion(blendDataError.attribute);
    if (suggestion) {
      enhanced.usageExample = suggestion.example;
      if (!enhanced.suggestion) {
        enhanced.suggestion = suggestion.message;
      }
    }
  }

  return enhanced;
}

// --- Parsers ---

interface AttributeErrorInfo {
  objectType: string;
  attribute: string;
  expression: string;
}

/**
 * Parses an AttributeError from a traceback or error message.
 * Pattern: "'<Type>' object has no attribute '<attr>'"
 */
function parseAttributeError(text: string): AttributeErrorInfo | null {
  const match = text.match(/AttributeError:\s*'([^']+)'\s+object has no attribute\s+'([^']+)'/);
  if (!match) return null;

  const objectType = match[1];
  const attribute = match[2];

  // Try to extract the expression from the traceback for dir() query
  // Look for the last line before the error that contains the attribute access
  const lines = text.split("\n");
  let expression = objectType.toLowerCase();
  for (const line of lines) {
    const exprMatch = line.match(
      new RegExp(`(\\S+)\\.${attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
    );
    if (exprMatch) {
      expression = exprMatch[1];
      break;
    }
  }

  return { objectType, attribute, expression };
}

interface KeyErrorInfo {
  key: string;
  collection: string;
}

/**
 * Parses a KeyError on a bpy.data collection.
 * Patterns: "KeyError: 'name'" with "bpy.data.<collection>" in context
 */
function parseKeyError(text: string): KeyErrorInfo | null {
  const keyMatch = text.match(/KeyError:\s*['"]([^'"]+)['"]/);
  if (!keyMatch) return null;

  const key = keyMatch[1];

  // Try to find the collection path
  const collMatch = text.match(/bpy\.data\.(\w+)\s*\[/);
  if (collMatch) {
    return { key, collection: `bpy.data.${collMatch[1]}` };
  }

  return null;
}

interface BlendDataErrorInfo {
  attribute: string;
}

/**
 * Parses 'BlendData' object has no attribute errors (Req 2.3).
 */
function parseBlendDataError(text: string): BlendDataErrorInfo | null {
  const match = text.match(/'BlendData'\s+object has no attribute\s+'([^']+)'/);
  if (!match) return null;
  return { attribute: match[1] };
}

// --- Blender Queries ---

/**
 * Queries Blender for dir() of an expression, returning a filtered list
 * of public attributes.
 */
async function queryDir(executeCode: ExecuteCodeFn, expression: string): Promise<string[]> {
  const code = `
import bpy, json
try:
    obj = ${expression}
    attrs = [a for a in dir(obj) if not a.startswith('_')]
    result = json.dumps(attrs[:200])
except:
    result = "[]"
`.trim();

  const output = await executeCode(code);
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

/**
 * Queries Blender for available keys in a collection (up to 200).
 */
async function queryCollectionKeys(
  executeCode: ExecuteCodeFn,
  collectionPath: string,
): Promise<string[] | null> {
  const code = `
import bpy, json
try:
    coll = ${collectionPath}
    keys = list(coll.keys())[:200]
    result = json.dumps(keys)
except:
    result = "null"
`.trim();

  const output = await executeCode(code);
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

// --- Suggestion Helpers ---

/**
 * Ranks candidates by Levenshtein similarity to the target,
 * filtering to ratio >= 0.6 and returning at most `max` results.
 */
function rankBySimilarity(target: string, candidates: string[], max: number): string[] {
  const scored = candidates
    .map((c) => ({ candidate: c, ratio: similarityRatio(target, c) }))
    .filter((s) => s.ratio >= 0.6)
    .sort((a, b) => b.ratio - a.ratio);

  return scored.slice(0, max).map((s) => s.candidate);
}

/** Known bpy.data method corrections. */
const BLEND_DATA_CORRECTIONS: Record<string, { message: string; example: string }> = {
  remove: {
    message:
      "bpy.data does not have a direct 'remove' method. Use bpy.data.<collection>.remove(item).",
    example: "bpy.data.objects.remove(bpy.data.objects['Cube'])",
  },
  add: {
    message: "bpy.data does not have a direct 'add' method. Use bpy.data.<collection>.new(name).",
    example: "bpy.data.meshes.new('MyMesh')",
  },
  create: {
    message: "bpy.data does not have a 'create' method. Use bpy.data.<collection>.new(name).",
    example: "bpy.data.materials.new('MyMaterial')",
  },
  delete: {
    message: "bpy.data does not have a 'delete' method. Use bpy.data.<collection>.remove(item).",
    example: "bpy.data.meshes.remove(bpy.data.meshes['Mesh'])",
  },
  new: {
    message: "bpy.data does not have a direct 'new' method. Use bpy.data.<collection>.new(name).",
    example: "bpy.data.objects.new('MyObject', bpy.data.meshes.new('Mesh'))",
  },
};

/**
 * Returns a correction message and example for common BlendData attribute errors.
 */
function getBlendDataSuggestion(attribute: string): { message: string; example: string } | null {
  // Direct match
  if (BLEND_DATA_CORRECTIONS[attribute]) {
    return BLEND_DATA_CORRECTIONS[attribute];
  }

  // Fuzzy match against known bpy.data collections
  const knownCollections = [
    "objects",
    "meshes",
    "materials",
    "textures",
    "images",
    "cameras",
    "lights",
    "armatures",
    "curves",
    "node_groups",
    "worlds",
    "actions",
    "particles",
    "fonts",
    "libraries",
    "scenes",
    "collections",
  ];

  const closest = findClosestMatches(attribute, knownCollections);
  if (closest.length > 0) {
    return {
      message: `'${attribute}' is not a valid bpy.data attribute. Did you mean '${closest[0]}'?`,
      example: `bpy.data.${closest[0]}`,
    };
  }

  return null;
}
