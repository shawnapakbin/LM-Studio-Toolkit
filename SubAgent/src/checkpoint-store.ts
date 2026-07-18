/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { Logger, getLogger } from "llm-toolkit-observability";

// ─── Types ───────────────────────────────────────────────────────────────────
// Defined locally until types.ts is created (Task 1.2).
// These mirror the design document interfaces exactly.

export interface TelemetryRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  wallClockMs: number;
  tokensPerSecond: number;
}

export interface CheckpointFile {
  taskId: string;
  inputHash: string;
  result: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  telemetry: TelemetryRecord;
  completedAt: string;
}

export interface TaskDefinition {
  taskId: string;
  prompt: string;
  systemPrompt?: string;
  allowedTools?: string[];
}

export interface TaskManifest {
  tasks: TaskDefinition[];
  systemPrompt?: string;
  synthesisPrompt?: string;
  mergePrompt?: string;
  temperature?: number;
  maxTokens?: number;
  modelContextSize?: number;
  concurrency?: number;
  maxRetries?: number;
  skipCache?: boolean;
  cacheMaxAge?: number;
  autoChunk?: boolean;
  keepCheckpoints?: boolean;
  taskTimeout?: number;
  dispatchTimeout?: number;
}

export interface ValidationResult {
  valid: boolean;
  mismatched: Array<{ taskId: string; storedHash: string; computedHash: string }>;
}

// ─── Hash Computation ────────────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 input hash for a task definition.
 *
 * Canonicalization rules (mirrors DedupCache.computeHash exactly):
 * 1. Sort allowedTools alphabetically (or use [] if absent)
 * 2. Sort model parameter keys alphabetically
 * 3. Treat null/omitted optional fields as empty strings
 * 4. Concatenate: systemPrompt + "|" + taskPrompt + "|" + JSON.stringify(sortedParams) + "|" + JSON.stringify(sortedTools)
 * 5. Hash with SHA-256, output as hex
 */
export function computeInputHash(task: TaskDefinition, manifest: TaskManifest): string {
  // Resolve system prompt: task-specific overrides shared, both default to empty string
  const systemPrompt = task.systemPrompt ?? manifest.systemPrompt ?? "";
  const taskPrompt = task.prompt ?? "";

  // Sort allowed tools alphabetically, default to empty array
  const sortedTools = [...(task.allowedTools ?? [])].sort();

  // Build sorted model parameters object — treat undefined/null as empty string
  const params: Record<string, string | number | boolean> = {};
  if (manifest.temperature !== undefined && manifest.temperature !== null) {
    params.temperature = manifest.temperature;
  } else {
    params.temperature = "";
  }
  if (manifest.maxTokens !== undefined && manifest.maxTokens !== null) {
    params.maxTokens = manifest.maxTokens;
  } else {
    params.maxTokens = "";
  }

  // Sort parameter keys alphabetically
  const sortedParams: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(params).sort()) {
    sortedParams[key] = params[key];
  }

  // Concatenate with pipe separator
  const canonical = `${systemPrompt}|${taskPrompt}|${JSON.stringify(sortedParams)}|${JSON.stringify(sortedTools)}`;

  // Hash with SHA-256
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ─── CheckpointStore ─────────────────────────────────────────────────────────

/**
 * JSON file persistence for per-task checkpoint results.
 *
 * Organizes checkpoint files by dispatch identifier with one JSON file per
 * completed task and a _manifest.json for the original TaskManifest.
 *
 * Directory structure:
 *   {baseDir}/{dispatchId}/_manifest.json
 *   {baseDir}/{dispatchId}/{taskId}.json
 *
 * Error handling:
 * - Disk I/O errors on write: logged at ERROR level, checkpointFailed flag set
 * - Corrupt JSON on read: logged at WARN level, task treated as incomplete
 */
export class CheckpointStore {
  private readonly baseDir: string;
  private readonly logger: Logger;

  constructor(baseDir: string = "./.subagent-checkpoints/") {
    this.baseDir = baseDir;
    this.logger = getLogger().child("CheckpointStore");
  }

  /**
   * Returns the directory path for a given dispatch.
   */
  private getDispatchDir(dispatchId: string): string {
    return path.join(this.baseDir, dispatchId);
  }

  /**
   * Returns the file path for the manifest within a dispatch directory.
   */
  private getManifestPath(dispatchId: string): string {
    return path.join(this.getDispatchDir(dispatchId), "_manifest.json");
  }

  /**
   * Returns the file path for a task checkpoint.
   */
  private getCheckpointPath(dispatchId: string, taskId: string): string {
    return path.join(this.getDispatchDir(dispatchId), `${taskId}.json`);
  }

  /**
   * Ensures the dispatch directory exists, creating it recursively if needed.
   */
  private async ensureDir(dispatchId: string): Promise<void> {
    await fs.mkdir(this.getDispatchDir(dispatchId), { recursive: true });
  }

  /**
   * Persists the original TaskManifest as _manifest.json in the dispatch directory.
   * Called at the start of execution.
   *
   * On disk I/O error: logs ERROR, sets checkpointFailed indicator (caller handles).
   */
  async writeManifest(dispatchId: string, manifest: TaskManifest): Promise<void> {
    try {
      await this.ensureDir(dispatchId);
      const filePath = this.getManifestPath(dispatchId);
      await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), "utf-8");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to write manifest checkpoint", {
        dispatchId,
        error: message,
      });
      throw new CheckpointWriteError(dispatchId, "_manifest", message);
    }
  }

  /**
   * Writes a per-task checkpoint JSON file containing the result, tokenUsage,
   * telemetry, completedAt, and inputHash.
   *
   * On disk I/O error: logs ERROR, does NOT throw — returns { checkpointFailed: true }.
   * The caller should set checkpointFailed on the affected task entry.
   */
  async writeCheckpoint(
    dispatchId: string,
    checkpoint: CheckpointFile,
  ): Promise<{ checkpointFailed: boolean }> {
    try {
      await this.ensureDir(dispatchId);
      const filePath = this.getCheckpointPath(dispatchId, checkpoint.taskId);
      await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf-8");
      return { checkpointFailed: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to write task checkpoint", {
        dispatchId,
        taskId: checkpoint.taskId,
        error: message,
      });
      return { checkpointFailed: true };
    }
  }

  /**
   * Reads the persisted TaskManifest from the dispatch directory.
   * Returns null if the manifest file does not exist.
   *
   * On corrupt JSON: logs WARN, returns null (treated as no manifest).
   */
  async readManifest(dispatchId: string): Promise<TaskManifest | null> {
    try {
      const filePath = this.getManifestPath(dispatchId);
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as TaskManifest;
    } catch (error: unknown) {
      if (isFileNotFoundError(error)) {
        return null;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Failed to read or parse manifest checkpoint", {
        dispatchId,
        error: message,
      });
      return null;
    }
  }

  /**
   * Reads all valid checkpoint files from the dispatch directory.
   * Skips the _manifest.json file and any files that cannot be parsed as JSON.
   *
   * On corrupt JSON for individual files: logs WARN, skips the file
   * (task treated as incomplete for resume purposes).
   */
  async readCheckpoints(dispatchId: string): Promise<CheckpointFile[]> {
    const dirPath = this.getDispatchDir(dispatchId);
    const checkpoints: CheckpointFile[] = [];

    try {
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        // Skip the manifest file
        if (file === "_manifest.json") continue;
        // Only process .json files
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(dirPath, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const checkpoint = JSON.parse(content) as CheckpointFile;

          // Basic validation: ensure required fields exist
          if (checkpoint.taskId && checkpoint.inputHash && checkpoint.result !== undefined) {
            checkpoints.push(checkpoint);
          } else {
            this.logger.warn("Checkpoint file missing required fields", {
              dispatchId,
              file,
            });
          }
        } catch (parseError: unknown) {
          const message = parseError instanceof Error ? parseError.message : String(parseError);
          this.logger.warn("Corrupt checkpoint file, treating task as incomplete", {
            dispatchId,
            file,
            error: message,
          });
          // Skip corrupt files — task will be re-dispatched on resume
        }
      }
    } catch (error: unknown) {
      if (isFileNotFoundError(error)) {
        return [];
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Failed to read checkpoint directory", {
        dispatchId,
        error: message,
      });
      return [];
    }

    return checkpoints;
  }

  /**
   * Deletes the entire dispatch checkpoint directory and all its contents.
   * Called after successful dispatch completion (unless keepCheckpoints is true).
   */
  async cleanup(dispatchId: string): Promise<void> {
    try {
      const dirPath = this.getDispatchDir(dispatchId);
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to clean up checkpoint directory", {
        dispatchId,
        error: message,
      });
    }
  }

  /**
   * Validates that each checkpoint file's stored inputHash matches the
   * inputHash recomputed from the persisted TaskManifest.
   *
   * Used during resume_dispatch to detect manifest tampering or corruption.
   * Returns a ValidationResult indicating which tasks have mismatched hashes.
   */
  async validateHashes(dispatchId: string, manifest: TaskManifest): Promise<ValidationResult> {
    const checkpoints = await this.readCheckpoints(dispatchId);
    const mismatched: Array<{ taskId: string; storedHash: string; computedHash: string }> = [];

    // Build a lookup map of task definitions by taskId
    const taskMap = new Map<string, TaskDefinition>();
    for (const task of manifest.tasks) {
      taskMap.set(task.taskId, task);
    }

    for (const checkpoint of checkpoints) {
      const taskDef = taskMap.get(checkpoint.taskId);
      if (!taskDef) {
        // Task in checkpoint but not in manifest — treat as mismatch
        mismatched.push({
          taskId: checkpoint.taskId,
          storedHash: checkpoint.inputHash,
          computedHash: "",
        });
        continue;
      }

      const computedHash = computeInputHash(taskDef, manifest);
      if (computedHash !== checkpoint.inputHash) {
        mismatched.push({
          taskId: checkpoint.taskId,
          storedHash: checkpoint.inputHash,
          computedHash,
        });
      }
    }

    return {
      valid: mismatched.length === 0,
      mismatched,
    };
  }
}

// ─── Error Types ─────────────────────────────────────────────────────────────

/**
 * Error thrown when a checkpoint manifest write fails.
 * For task checkpoints, writeCheckpoint returns { checkpointFailed: true } instead.
 */
export class CheckpointWriteError extends Error {
  public readonly dispatchId: string;
  public readonly taskId: string;

  constructor(dispatchId: string, taskId: string, cause: string) {
    super(`Checkpoint write failed for dispatch=${dispatchId}, task=${taskId}: ${cause}`);
    this.name = "CheckpointWriteError";
    this.dispatchId = dispatchId;
    this.taskId = taskId;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Checks if an error is a "file not found" (ENOENT) error.
 */
function isFileNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}
