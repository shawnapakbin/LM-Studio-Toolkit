/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import path from "path";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  reason?: string;
}

const UNTRUSTED_REGISTRIES = ["registry.npmjs.com", "pypi.org", "crates.io"];
const BLOCKED_PACKAGES = ["rm -rf", "eval", "__proto__", "constructor"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getPackageManagerWorkspaceRoot(): string {
  return (
    process.env.PACKAGE_MANAGER_WORKSPACE_ROOT ||
    process.env.FILE_EDITOR_WORKSPACE_ROOT ||
    process.cwd()
  );
}

/**
 * Validate workspace path to prevent directory traversal
 */
export function validateWorkspacePath(workspacePath: string): ValidationResult {
  try {
    const cwd = getPackageManagerWorkspaceRoot();
    const normalized = path.normalize(workspacePath);
    const absolute = path.resolve(cwd, normalized);

    // Check if resolved path is within workspace
    if (!absolute.startsWith(path.resolve(cwd))) {
      return {
        valid: false,
        error: "Path traversal detected",
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    return {
      valid: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Validate package names to prevent injection attacks
 */
export function validatePackageNames(packages: string[]): ValidationResult {
  for (const pkg of packages) {
    // Check for suspicious patterns
    if (BLOCKED_PACKAGES.some((blocked) => pkg.includes(blocked))) {
      return {
        valid: false,
        reason: `Package name contains blocked pattern: ${pkg}`,
      };
    }

    // Check for command injection attempts
    if (pkg.includes(";") || pkg.includes("|") || pkg.includes("&") || pkg.includes("`")) {
      return {
        valid: false,
        reason: `Package name contains shell metacharacters: ${pkg}`,
      };
    }

    // Check for valid package name format
    if (!/^[@a-z0-9\-./_]+$/i.test(pkg)) {
      return {
        valid: false,
        reason: `Invalid package name format: ${pkg}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Check if package is from untrusted registry
 */
export function isFromUntrustedRegistry(packageUrl: string): boolean {
  return UNTRUSTED_REGISTRIES.some((registry) => packageUrl.includes(registry));
}

/**
 * Validate severity level
 */
export function isValidSeverity(severity: string): boolean {
  return ["low", "moderate", "high", "critical"].includes(severity);
}

/**
 * Check if operation requires elevated permissions
 */
export function requiresElevatedPermissions(operation: string, isGlobal: boolean): boolean {
  return operation === "install" && isGlobal;
}

/**
 * Validate manifest file exists
 */
export async function manifestFileExists(
  manifestFile: string,
  cwd: string,
): Promise<ValidationResult> {
  try {
    const fs = await import("fs").then((m) => m.promises);
    const filePath = path.join(cwd, manifestFile);

    try {
      await fs.access(filePath);
      return { valid: true };
    } catch {
      return {
        valid: false,
        error: `Manifest file not found: ${manifestFile}`,
      };
    }
  } catch (error: unknown) {
    return {
      valid: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Rate limit check for package operations
 */
const operationCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_OPERATIONS_PER_WINDOW = 10;

export function checkRateLimit(operation: string): ValidationResult {
  const now = Date.now();
  const key = `${operation}`;

  if (!operationCounts.has(key)) {
    operationCounts.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { valid: true };
  }

  const record = operationCounts.get(key)!;

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW;
    return { valid: true };
  }

  record.count++;
  if (record.count > MAX_OPERATIONS_PER_WINDOW) {
    return {
      valid: false,
      reason: `Rate limit exceeded: ${MAX_OPERATIONS_PER_WINDOW} operations per minute`,
    };
  }

  return { valid: true };
}

/**
 * Validate registry URL (for custom registry support)
 */
export function isValidRegistry(registry: string): ValidationResult {
  try {
    new URL(registry);
    // Check for https:// or similar secure protocols
    if (!registry.startsWith("https://") && !registry.startsWith("http://")) {
      return {
        valid: false,
        reason: "Registry must use https:// or http:// protocol",
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      reason: "Invalid registry URL format",
    };
  }
}

/**
 * Validate that operation is allowed on this package manager
 */
export function isOperationSupported(manager: string, operation: string): ValidationResult {
  const supportedOperations: Record<string, string[]> = {
    npm: ["install", "update", "audit", "outdated", "uninstall", "list"],
    pip: ["install", "update", "audit", "outdated", "uninstall", "list"],
    cargo: ["install", "update", "audit", "outdated", "remove", "tree"],
    maven: ["install", "audit", "list"],
    gradle: ["install", "audit", "list"],
    go: ["install", "update", "list"],
  };

  const supported = supportedOperations[manager] || [];
  if (!supported.includes(operation)) {
    return {
      valid: false,
      reason: `Operation '${operation}' not supported for package manager '${manager}'`,
    };
  }

  return { valid: true };
}
