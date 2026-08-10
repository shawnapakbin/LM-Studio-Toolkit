/**
 * Configuration file watcher with hot-reload support.
 * Watches the JSON config file for external changes and triggers reload.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import * as fs from "fs";
import * as path from "path";
import { DEFAULT_CONFIG, LanSubAgentConfig, LanSubAgentConfigSchema } from "./config-schema";
import { Logger, logger as defaultLogger } from "./logger";

export class ConfigWatcher {
  private filePath: string;
  private watcher: fs.FSWatcher | null = null;
  private lastConfig: LanSubAgentConfig = DEFAULT_CONFIG;
  private debounceTimer: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(filePath: string, logger?: Logger) {
    this.filePath = path.resolve(filePath);
    this.logger = logger ?? defaultLogger;
  }

  /**
   * Load config from disk, or create default if the file is missing.
   * If the file contains invalid JSON, logs an error and falls back to
   * the default config (empty endpoints) without crashing.
   */
  async loadOrCreate(): Promise<LanSubAgentConfig> {
    try {
      const content = await fs.promises.readFile(this.filePath, "utf-8");
      let parsed: unknown;

      try {
        parsed = JSON.parse(content);
      } catch {
        this.logger.error(
          `Config file at ${this.filePath} contains invalid JSON. Falling back to default config.`,
        );
        this.lastConfig = DEFAULT_CONFIG;
        return this.lastConfig;
      }

      const result = LanSubAgentConfigSchema.safeParse(parsed);
      if (result.success) {
        this.lastConfig = result.data;
        this.logger.info(`Loaded config from ${this.filePath}`);
      } else {
        this.logger.error(
          `Config validation failed: ${result.error.issues.map((i) => i.message).join("; ")}. Falling back to default config.`,
        );
        this.lastConfig = DEFAULT_CONFIG;
      }

      return this.lastConfig;
    } catch (err: unknown) {
      // File doesn't exist — create default
      if (isNodeError(err) && err.code === "ENOENT") {
        this.logger.info(`Config file not found at ${this.filePath}. Creating default config.`);
        await this.writeConfig(DEFAULT_CONFIG);
        this.lastConfig = DEFAULT_CONFIG;
        return this.lastConfig;
      }

      // Unexpected read error
      this.logger.error(
        `Unexpected error reading config: ${err instanceof Error ? err.message : String(err)}. Falling back to default config.`,
      );
      this.lastConfig = DEFAULT_CONFIG;
      return this.lastConfig;
    }
  }

  /**
   * Start watching the config file for external changes.
   * Uses fs.watch with a 500ms debounce to collapse rapid successive events.
   * Calls `onChange` only when the config actually changed.
   */
  startWatching(onChange: (config: LanSubAgentConfig) => void): void {
    if (this.watcher) {
      this.logger.warn("ConfigWatcher is already watching. Call stopWatching() first.");
      return;
    }

    try {
      this.watcher = fs.watch(this.filePath, (eventType) => {
        if (eventType === "change" || eventType === "rename") {
          this.debounceReload(onChange);
        }
      });

      this.watcher.on("error", (err) => {
        this.logger.warn(
          `Config file watch error: ${err.message}. Continuing with last known config.`,
        );
      });

      this.logger.info(`Started watching config file: ${this.filePath}`);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to start watching config file: ${err instanceof Error ? err.message : String(err)}. Continuing with last known config.`,
      );
    }
  }

  /**
   * Stop watching and clean up resources.
   */
  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.logger.info("Stopped watching config file.");
    }
  }

  /**
   * Write config to disk with pretty-print (2-space indent).
   * Used by the GUI to persist changes.
   */
  async writeConfig(config: LanSubAgentConfig): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const content = JSON.stringify(config, null, 2) + "\n";
    await fs.promises.writeFile(this.filePath, content, "utf-8");
    this.lastConfig = config;
  }

  /**
   * Validate a config object using the Zod schema.
   * Returns whether the config is valid and any validation errors.
   */
  static validate(config: unknown): { valid: boolean; errors: string[] } {
    const result = LanSubAgentConfigSchema.safeParse(config);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return { valid: false, errors };
  }

  /**
   * Get the last loaded config (useful for components that need
   * the current config without re-reading from disk).
   */
  getLastConfig(): LanSubAgentConfig {
    return this.lastConfig;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private debounceReload(onChange: (config: LanSubAgentConfig) => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      try {
        const content = await fs.promises.readFile(this.filePath, "utf-8");
        let parsed: unknown;

        try {
          parsed = JSON.parse(content);
        } catch {
          this.logger.error(
            "Config file change detected but contains invalid JSON. Ignoring change.",
          );
          return;
        }

        const result = LanSubAgentConfigSchema.safeParse(parsed);
        if (!result.success) {
          this.logger.error(
            `Config validation failed on reload: ${result.error.issues.map((i) => i.message).join("; ")}. Ignoring change.`,
          );
          return;
        }

        const newConfig = result.data;

        // Only notify if config actually changed
        if (JSON.stringify(newConfig) !== JSON.stringify(this.lastConfig)) {
          this.lastConfig = newConfig;
          this.logger.info("Config file changed. Reloading.");
          onChange(newConfig);
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Error reading config on reload: ${err instanceof Error ? err.message : String(err)}. Continuing with last known config.`,
        );
      }
    }, 500);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
