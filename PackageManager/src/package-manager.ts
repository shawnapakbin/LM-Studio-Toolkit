/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { z } from "zod";

const execAsync = promisify(exec);

const TIMEOUT_MS = 60000; // 60 seconds for package operations

export type DetectPackageManagerInput = z.infer<typeof DetectPackageManagerSchema>;
export type InstallPackagesInput = z.infer<typeof InstallPackagesSchema>;
export type UpdatePackagesInput = z.infer<typeof UpdatePackagesSchema>;
export type AuditVulnerabilitiesInput = z.infer<typeof AuditVulnerabilitiesSchema>;
export type ListOutdatedInput = z.infer<typeof ListOutdatedSchema>;
export type RemoveDependenciesInput = z.infer<typeof RemoveDependenciesSchema>;
export type ViewDependenciesInput = z.infer<typeof ViewDependenciesSchema>;
export type LockDependenciesInput = z.infer<typeof LockDependenciesSchema>;

export const DetectPackageManagerSchema = z.object({});

export const InstallPackagesSchema = z.object({
  packages: z.array(z.string()).min(1, "at least one package required"),
  dev: z.boolean().optional().default(false),
  global: z.boolean().optional().default(false),
});

export const UpdatePackagesSchema = z.object({
  packages: z.array(z.string()).optional(),
  all: z.boolean().optional().default(false),
  check: z.boolean().optional().default(false),
});

export const AuditVulnerabilitiesSchema = z.object({
  fix: z.boolean().optional().default(false),
  severity: z.enum(["low", "moderate", "high", "critical"]).optional(),
});

export const ListOutdatedSchema = z.object({
  format: z.enum(["list", "json", "outdated"]).optional().default("list"),
});

export const RemoveDependenciesSchema = z.object({
  packages: z.array(z.string()).min(1, "at least one package required"),
});

export const ViewDependenciesSchema = z.object({
  depth: z.number().int().nonnegative().optional().default(0),
  onlyDirect: z.boolean().optional().default(false),
});

export const LockDependenciesSchema = z.object({
  frozen: z.boolean().optional().default(true),
});

type PackageManager = "npm" | "pip" | "cargo" | "maven" | "gradle" | "go" | "unknown";

interface DetectionResult {
  manager: PackageManager;
  version?: string;
  manifestFile: string;
  lockFile?: string;
}

async function runCommand(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execAsync(command, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result;
  } catch (error: unknown) {
    const execError = error as Partial<NodeJS.ErrnoException> & {
      stdout?: string;
      stderr?: string;
    };
    return {
      stdout: execError.stdout || "",
      stderr: execError.stderr || execError.message || String(error),
    };
  }
}

/**
 * Detect package manager and get version info
 */
export async function detectPackageManager(
  cwd: string,
): Promise<{ detected: DetectionResult | null; available: string[] }> {
  const available: string[] = [];
  let detected: DetectionResult | null = null;

  // Check npm (most common, check first)
  const { stdout: npmVersion } = await runCommand("npm --version", cwd);
  if (npmVersion && !npmVersion.includes("not found")) {
    available.push("npm");
    // Check for package.json
    try {
      const { stdout } = await runCommand("test -f package.json && echo found", cwd);
      if (stdout.includes("found")) {
        detected = {
          manager: "npm",
          version: npmVersion.trim(),
          manifestFile: "package.json",
          lockFile: "package-lock.json",
        };
      }
    } catch {}
  }

  // Check pip (Python)
  const { stdout: pipVersion } = await runCommand("python -m pip --version", cwd);
  if (pipVersion && !pipVersion.includes("not found")) {
    available.push("pip");
    if (!detected) {
      const { stdout } = await runCommand("test -f requirements.txt && echo found", cwd);
      if (stdout.includes("found")) {
        detected = {
          manager: "pip",
          version: pipVersion.split(" ")[1],
          manifestFile: "requirements.txt",
          lockFile: "requirements-lock.txt",
        };
      }
    }
  }

  // Check cargo (Rust)
  const { stdout: cargoVersion } = await runCommand("cargo --version", cwd);
  if (cargoVersion && !cargoVersion.includes("not found")) {
    available.push("cargo");
    if (!detected) {
      const { stdout } = await runCommand("test -f Cargo.toml && echo found", cwd);
      if (stdout.includes("found")) {
        detected = {
          manager: "cargo",
          version: cargoVersion.split(" ")[1],
          manifestFile: "Cargo.toml",
          lockFile: "Cargo.lock",
        };
      }
    }
  }

  // Check Maven
  const { stdout: mvnVersion } = await runCommand("mvn --version", cwd);
  if (mvnVersion && !mvnVersion.includes("not found")) {
    available.push("maven");
    if (!detected) {
      const { stdout } = await runCommand("test -f pom.xml && echo found", cwd);
      if (stdout.includes("found")) {
        detected = {
          manager: "maven",
          version: mvnVersion.split("\n")[0],
          manifestFile: "pom.xml",
        };
      }
    }
  }

  // Check Gradle
  const { stdout: gradleVersion } = await runCommand("gradle --version", cwd);
  if (gradleVersion && !gradleVersion.includes("not found")) {
    available.push("gradle");
    if (!detected) {
      const { stdout } = await runCommand("test -f build.gradle && echo found", cwd);
      if (stdout.includes("found")) {
        detected = {
          manager: "gradle",
          version: gradleVersion.split("\n")[0],
          manifestFile: "build.gradle",
        };
      }
    }
  }

  // Check Go modules
  const { stdout: goVersion } = await runCommand("go version", cwd);
  if (goVersion && !goVersion.includes("not found")) {
    available.push("go");
    if (!detected) {
      const { stdout } = await runCommand("test -f go.mod && echo found", cwd);
      if (stdout.includes("found")) {
        detected = {
          manager: "go",
          version: goVersion.split(" ")[2],
          manifestFile: "go.mod",
          lockFile: "go.sum",
        };
      }
    }
  }

  return { detected, available };
}

/**
 * Install packages
 */
export async function installPackages(
  input: InstallPackagesInput,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; installed: number }> {
  let command = "";

  switch (manager) {
    case "npm":
      command = `npm install ${input.packages.join(" ")}`;
      if (input.dev) command += " --save-dev";
      if (input.global) command += " --global";
      break;
    case "pip":
      command = `python -m pip install ${input.packages.join(" ")}`;
      break;
    case "cargo":
      if (input.packages.length > 1) {
        command = input.packages.map((p) => `cargo add ${p}`).join(" && ");
      } else {
        command = `cargo add ${input.packages[0]}`;
      }
      break;
    case "maven":
      command = input.packages.map((p) => `mvn dependency:get -Dartifact=${p}`).join(" && ");
      break;
    case "go":
      command = input.packages.map((p) => `go get ${p}`).join(" && ");
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  return {
    output: stdout || stderr,
    installed: input.packages.length,
  };
}

/**
 * Update packages
 */
export async function updatePackages(
  input: UpdatePackagesInput,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; updated: number }> {
  let command = "";

  switch (manager) {
    case "npm":
      if (input.check) {
        command = "npm outdated";
      } else if (input.all || !input.packages?.length) {
        command = "npm update";
      } else {
        command = `npm update ${input.packages?.join(" ")}`;
      }
      break;
    case "pip":
      if (input.all || !input.packages?.length) {
        command = "python -m pip install --upgrade pip";
      } else {
        command = `python -m pip install --upgrade ${input.packages?.join(" ")}`;
      }
      break;
    case "cargo":
      command = "cargo update";
      if (input.packages?.length) {
        command += ` --package ${input.packages[0]}`;
      }
      break;
    case "go":
      command = "go get -u ./...";
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  return {
    output: stdout || stderr,
    updated: input.packages?.length || 0,
  };
}

/**
 * Audit for vulnerabilities
 */
export async function auditVulnerabilities(
  input: AuditVulnerabilitiesInput,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; vulnerabilities: number }> {
  let command = "";

  switch (manager) {
    case "npm":
      command = "npm audit";
      if (input.fix) command += " --fix";
      if (input.severity) command += ` --audit-level=${input.severity}`;
      break;
    case "pip":
      command = "python -m pip-audit";
      break;
    case "cargo":
      command = "cargo audit";
      break;
    case "maven":
      command = "mvn dependency-check:check";
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  const vulnCount = (stdout.match(/vulnerabilit|issue/gi) || []).length;
  return {
    output: stdout || stderr,
    vulnerabilities: vulnCount,
  };
}

/**
 * List outdated packages
 */
export async function listOutdated(
  input: z.infer<typeof ListOutdatedSchema>,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; outdated: number }> {
  let command = "";

  switch (manager) {
    case "npm":
      command = "npm outdated";
      if (input.format === "json") command += " --json";
      break;
    case "pip":
      command = "python -m pip list --outdated";
      break;
    case "cargo":
      command = "cargo outdated";
      break;
    case "go":
      command = "go list -u -m all";
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  const outdatedCount = (stdout.match(/outdated|available/gi) || []).length;
  return {
    output: stdout || stderr,
    outdated: outdatedCount,
  };
}

/**
 * Remove dependencies
 */
export async function removeDependencies(
  input: RemoveDependenciesInput,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; removed: number }> {
  let command = "";

  switch (manager) {
    case "npm":
      command = `npm uninstall ${input.packages.join(" ")}`;
      break;
    case "pip":
      command = `python -m pip uninstall -y ${input.packages.join(" ")}`;
      break;
    case "cargo":
      command = input.packages.map((p) => `cargo remove ${p}`).join(" && ");
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  return {
    output: stdout || stderr,
    removed: input.packages.length,
  };
}

/**
 * View dependencies
 */
export async function viewDependencies(
  input: ViewDependenciesInput,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; dependencyCount: number }> {
  let command = "";

  switch (manager) {
    case "npm":
      command = "npm list";
      if (input.depth >= 0) command += ` --depth=${input.depth}`;
      break;
    case "pip":
      command = "python -m pip list";
      break;
    case "cargo":
      command = "cargo tree";
      if (input.onlyDirect) command += " --depth 1";
      break;
    case "go":
      command = "go list -m all";
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  const depCount = (stdout.match(/\n/g) || []).length;
  return {
    output: stdout || stderr,
    dependencyCount: depCount,
  };
}

/**
 * Lock/freeze dependencies
 */
export async function lockDependencies(
  input: LockDependenciesInput,
  manager: PackageManager,
  cwd: string,
): Promise<{ output: string; locked: boolean }> {
  let command = "";

  switch (manager) {
    case "npm":
      if (input.frozen) {
        command = "npm ci";
      } else {
        command = "npm install";
      }
      break;
    case "pip":
      if (input.frozen) {
        command = "python -m pip install --require-hashes -r requirements.txt";
      } else {
        command = "python -m pip freeze > requirements.txt";
      }
      break;
    case "cargo":
      command = "cargo check";
      break;
    default:
      throw new Error(`Unsupported package manager: ${manager}`);
  }

  const { stdout, stderr } = await runCommand(command, cwd);
  return {
    output: stdout || stderr,
    locked: input.frozen,
  };
}
