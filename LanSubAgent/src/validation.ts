import { logger } from "./logger";
import { EndpointDefinition } from "./types";

export interface ValidationResult {
  valid: EndpointDefinition[];
  errors: Array<{ id?: string; reasons: string[] }>;
}

/**
 * Validates an array of endpoint-like objects and returns the valid subset.
 * Invalid entries are filtered out with logged warnings. Never throws.
 */
export function validateEndpoints(entries: unknown[]): ValidationResult {
  const valid: EndpointDefinition[] = [];
  const errors: Array<{ id?: string; reasons: string[] }> = [];

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      errors.push({ reasons: ["entry is not an object"] });
      logger.warn("Endpoint validation failed: entry is not an object");
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : undefined;
    const reasons: string[] = [];

    // host: must be a non-empty string
    if (typeof obj.host !== "string" || obj.host.trim().length === 0) {
      reasons.push("host must be a non-empty string");
    }

    // port: must be an integer between 1 and 65535
    if (
      typeof obj.port !== "number" ||
      !Number.isInteger(obj.port) ||
      obj.port < 1 ||
      obj.port > 65535
    ) {
      reasons.push("port must be an integer between 1 and 65535");
    }

    // models: must be an array with at most 50 entries
    if (!Array.isArray(obj.models)) {
      reasons.push("models must be an array");
    } else if (obj.models.length > 50) {
      reasons.push("models array must have at most 50 entries");
    }

    // maxConcurrency: must be between 1 and 100
    if (
      typeof obj.maxConcurrency !== "number" ||
      !Number.isInteger(obj.maxConcurrency) ||
      obj.maxConcurrency < 1 ||
      obj.maxConcurrency > 100
    ) {
      reasons.push("maxConcurrency must be an integer between 1 and 100");
    }

    if (reasons.length > 0) {
      errors.push({ id, reasons });
      const label = id ? ` for "${id}"` : "";
      logger.warn(`Endpoint validation failed${label}: ${reasons.join("; ")}`);
    } else {
      valid.push(obj as unknown as EndpointDefinition);
    }
  }

  return { valid, errors };
}
