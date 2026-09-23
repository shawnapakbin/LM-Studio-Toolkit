import * as fs from "fs";
import * as os from "os";
import * as path from "path";
/**
 * Property 16: Installation Path Validation
 *
 * For any path string provided as a custom installation directory, the Installer
 * must accept the path only if it is writable AND contains no more than 200
 * characters, and must reject the path with a descriptive error otherwise.
 *
 * Note: The writable check is backend-only (Rust). This property test validates
 * the client-side rules: empty/whitespace, length > 200, invalid Windows
 * characters, and control characters.
 *
 * Validates: Requirements 7.2
 *
 * Property 17: Cancellation Cleanup
 *
 * For any installation phase where the user initiates cancellation, the Installer
 * must remove all partially installed components from the installation directory,
 * leaving no orphaned files. The parent install directory itself must remain.
 *
 * Validates: Requirements 7.8
 *
 * Property 18: Installation Logging Completeness
 *
 * For any sequence of installation actions (phase starts, phase completions,
 * downloads, errors), the install.log file must contain a timestamped entry
 * for each action with the phase name and relevant details.
 *
 * Validates: Requirements 7.9
 */
import fc from "fast-check";
import { CLEANUP_SUBDIRS, cleanupInstallation } from "../../src/utils/cleanup";
import { InstallLogger, KNOWN_PHASES, type LogEntry } from "../../src/utils/logger";
import {
  INVALID_WINDOWS_CHARS,
  MAX_PATH_LENGTH,
  validateInstallPath,
} from "../../src/utils/path-validation";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for a known installation phase name */
const phaseArb = fc.constantFrom(...KNOWN_PHASES);

/** Arbitrary for a log level */
const _levelArb = fc.constantFrom("info" as const, "warn" as const, "error" as const);

/** Arbitrary for a non-empty message string */
const messageArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary for a URL-like string */
const urlArb = fc.webUrl();

/** Represents a log action that can be replayed */
type LogAction =
  | { type: "phase_start"; phase: string }
  | { type: "phase_complete"; phase: string }
  | { type: "download"; phase: string; url: string }
  | { type: "error"; phase: string; message: string }
  | { type: "info"; phase: string; message: string }
  | { type: "warn"; phase: string; message: string };

/** Arbitrary for a single log action */
const logActionArb: fc.Arbitrary<LogAction> = fc.oneof(
  fc.record({ type: fc.constant("phase_start" as const), phase: phaseArb }),
  fc.record({ type: fc.constant("phase_complete" as const), phase: phaseArb }),
  fc.record({ type: fc.constant("download" as const), phase: phaseArb, url: urlArb }),
  fc.record({ type: fc.constant("error" as const), phase: phaseArb, message: messageArb }),
  fc.record({ type: fc.constant("info" as const), phase: phaseArb, message: messageArb }),
  fc.record({ type: fc.constant("warn" as const), phase: phaseArb, message: messageArb }),
);

/** Arbitrary for a sequence of log actions */
const logActionsArb = fc.array(logActionArb, { minLength: 1, maxLength: 50 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Replay a sequence of actions against the logger and return the actions */
function replayActions(logger: InstallLogger, actions: LogAction[]): void {
  for (const action of actions) {
    switch (action.type) {
      case "phase_start":
        logger.logPhaseStart(action.phase);
        break;
      case "phase_complete":
        logger.logPhaseComplete(action.phase);
        break;
      case "download":
        logger.logDownload(action.phase, action.url);
        break;
      case "error":
        logger.logError(action.phase, action.message);
        break;
      case "info":
        logger.logInfo(action.phase, action.message);
        break;
      case "warn":
        logger.logWarn(action.phase, action.message);
        break;
    }
  }
}

/** Get the expected level for a given action type */
function expectedLevel(action: LogAction): LogEntry["level"] {
  switch (action.type) {
    case "phase_start":
    case "phase_complete":
    case "download":
    case "info":
      return "info";
    case "error":
      return "error";
    case "warn":
      return "warn";
  }
}

/** ISO 8601 date pattern: matches timestamps like 2024-01-15T10:30:00.000Z */
const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// ─── Property 17: Cancellation Cleanup ───────────────────────────────────────

/** Create a unique temp directory for each test run. */
function createTempInstallDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "llm-toolkit-cleanup-test-"));
}

/** Remove a temp directory after test. */
function removeTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Arbitrary for a random file name (safe characters only).
 * Generates alphanumeric names between 1-20 chars.
 */
const safeFileNameArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .filter((s) => s.length > 0 && !CLEANUP_SUBDIRS.includes(s as (typeof CLEANUP_SUBDIRS)[number]));

/**
 * Arbitrary for a random installation directory structure that might exist
 * during any phase. Covers all combinations of presence/absence of the
 * `llm-toolkit/` and `downloads/` subdirectories with varying contents.
 */
const installStructureArb = fc.record({
  /** Whether the llm-toolkit subdirectory exists */
  hasRepo: fc.boolean(),
  /** Files inside llm-toolkit/ (if it exists) */
  repoFiles: fc.array(safeFileNameArb, { minLength: 0, maxLength: 5 }),
  /** Nested subdirectories inside llm-toolkit/ */
  repoSubdirs: fc.array(safeFileNameArb, { minLength: 0, maxLength: 3 }),
  /** Whether the downloads subdirectory exists */
  hasDownloads: fc.boolean(),
  /** Files inside downloads/ (if it exists) */
  downloadFiles: fc.array(safeFileNameArb, { minLength: 0, maxLength: 5 }),
  /** Extra files in the install root (should NOT be removed) */
  rootFiles: fc.array(safeFileNameArb, { minLength: 0, maxLength: 3 }),
});

type InstallStructure = {
  hasRepo: boolean;
  repoFiles: string[];
  repoSubdirs: string[];
  hasDownloads: boolean;
  downloadFiles: string[];
  rootFiles: string[];
};

/**
 * Materialize an install structure on disk.
 */
function createInstallStructure(installPath: string, structure: InstallStructure): void {
  // Create root-level files (these should survive cleanup)
  for (const fileName of structure.rootFiles) {
    const filePath = path.join(installPath, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `root-file-content-${fileName}`);
    }
  }

  // Create llm-toolkit/ subdirectory with contents
  if (structure.hasRepo) {
    const repoDir = path.join(installPath, "llm-toolkit");
    fs.mkdirSync(repoDir, { recursive: true });

    for (const fileName of structure.repoFiles) {
      fs.writeFileSync(path.join(repoDir, fileName), `repo-content-${fileName}`);
    }

    for (const subdir of structure.repoSubdirs) {
      const subdirPath = path.join(repoDir, subdir);
      fs.mkdirSync(subdirPath, { recursive: true });
      fs.writeFileSync(path.join(subdirPath, "nested.txt"), "nested-content");
    }
  }

  // Create downloads/ subdirectory with contents
  if (structure.hasDownloads) {
    const downloadsDir = path.join(installPath, "downloads");
    fs.mkdirSync(downloadsDir, { recursive: true });

    for (const fileName of structure.downloadFiles) {
      fs.writeFileSync(path.join(downloadsDir, fileName), `download-content-${fileName}`);
    }
  }
}

describe("Feature: v2-4-0-unified-config-installer, Property 17: Cancellation Cleanup", () => {
  /**
   * Validates: Requirements 7.8
   */

  describe("Property 17a: cleanup removes llm-toolkit/ and downloads/ subdirectories", () => {
    it("for any set of partially created files/directories, cleanup removes target subdirs", () => {
      fc.assert(
        fc.property(installStructureArb, (structure) => {
          const installPath = createTempInstallDir();
          try {
            createInstallStructure(installPath, structure);

            cleanupInstallation(installPath);

            // Both target subdirectories must be gone
            for (const subdir of CLEANUP_SUBDIRS) {
              const subdirPath = path.join(installPath, subdir);
              expect(fs.existsSync(subdirPath)).toBe(false);
            }
          } finally {
            removeTempDir(installPath);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 17b: cleanup preserves the parent install directory", () => {
    it("for any install structure, the parent directory still exists after cleanup", () => {
      fc.assert(
        fc.property(installStructureArb, (structure) => {
          const installPath = createTempInstallDir();
          try {
            createInstallStructure(installPath, structure);

            cleanupInstallation(installPath);

            expect(fs.existsSync(installPath)).toBe(true);
            expect(fs.statSync(installPath).isDirectory()).toBe(true);
          } finally {
            removeTempDir(installPath);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 17c: cleanup preserves root-level files not in target subdirs", () => {
    it("files placed directly in the install root are not removed by cleanup", () => {
      fc.assert(
        fc.property(
          installStructureArb.filter((s) => s.rootFiles.length > 0),
          (structure) => {
            const installPath = createTempInstallDir();
            try {
              createInstallStructure(installPath, structure);

              cleanupInstallation(installPath);

              // Root-level files should still exist
              for (const fileName of structure.rootFiles) {
                const filePath = path.join(installPath, fileName);
                expect(fs.existsSync(filePath)).toBe(true);
              }
            } finally {
              removeTempDir(installPath);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 17d: cleanup is idempotent", () => {
    it("running cleanup multiple times produces the same result as running it once", () => {
      fc.assert(
        fc.property(installStructureArb, (structure) => {
          const installPath = createTempInstallDir();
          try {
            createInstallStructure(installPath, structure);

            // Run cleanup twice
            cleanupInstallation(installPath);
            cleanupInstallation(installPath);

            // Still no target subdirs, parent still exists
            for (const subdir of CLEANUP_SUBDIRS) {
              expect(fs.existsSync(path.join(installPath, subdir))).toBe(false);
            }
            expect(fs.existsSync(installPath)).toBe(true);
          } finally {
            removeTempDir(installPath);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 17e: cleanup handles empty install directory gracefully", () => {
    it("cleanup on a directory with no target subdirs does not throw and preserves the directory", () => {
      fc.assert(
        fc.property(
          installStructureArb.map((s) => ({ ...s, hasRepo: false, hasDownloads: false })),
          (structure) => {
            const installPath = createTempInstallDir();
            try {
              createInstallStructure(installPath, structure);

              expect(() => cleanupInstallation(installPath)).not.toThrow();
              expect(fs.existsSync(installPath)).toBe(true);
            } finally {
              removeTempDir(installPath);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

// ─── Property 16: Installation Path Validation ──────────────────────────────

// ─── Arbitraries (Path Validation) ───────────────────────────────────────────

/** Valid characters for Windows path segments (printable ASCII minus invalid chars) */
const validPathChars = fc.char().filter((c) => {
  const code = c.charCodeAt(0);
  // Must be printable (> 31), not an invalid Windows char, and not backslash (separator)
  return code > 31 && !INVALID_WINDOWS_CHARS.includes(c) && c !== "\\";
});

/** Generate a valid Windows drive prefix like "C:" or "D:" */
const drivePrefix = fc.constantFrom("C:", "D:", "E:");

/** Generate a valid path segment (non-empty, valid chars only) */
const validSegment = fc
  .array(validPathChars, { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(""));

/**
 * Generate a valid Windows path:
 * - Starts with a drive letter
 * - Has 1-5 path segments separated by backslash
 * - Total length <= MAX_PATH_LENGTH
 */
const validPathArb = fc
  .tuple(drivePrefix, fc.array(validSegment, { minLength: 1, maxLength: 5 }))
  .map(([drive, segments]) => `${drive}\\${segments.join("\\")}`)
  .filter((p) => p.length <= MAX_PATH_LENGTH && p.trim().length > 0);

/** Generate a path that exceeds MAX_PATH_LENGTH */
const tooLongPathArb = fc
  .tuple(drivePrefix, fc.integer({ min: MAX_PATH_LENGTH, max: MAX_PATH_LENGTH + 200 }))
  .map(([drive, targetLen]) => {
    const prefix = `${drive}\\`;
    const needed = targetLen - prefix.length;
    return prefix + "a".repeat(Math.max(needed, 1));
  })
  .filter((p) => p.length > MAX_PATH_LENGTH);

/** Generate a path containing at least one invalid Windows character */
const invalidCharPathArb = fc
  .tuple(drivePrefix, validSegment, fc.constantFrom(...INVALID_WINDOWS_CHARS), validSegment)
  .map(([drive, before, badChar, after]) => `${drive}\\${before}${badChar}${after}`)
  .filter((p) => p.length <= MAX_PATH_LENGTH);

/** Generate a path containing at least one control character */
const controlCharPathArb = fc
  .tuple(
    drivePrefix,
    validSegment,
    fc.integer({ min: 1, max: 31 }).map((code) => String.fromCharCode(code)),
    validSegment,
  )
  .map(([drive, before, ctrl, after]) => `${drive}\\${before}${ctrl}${after}`)
  .filter((p) => p.length <= MAX_PATH_LENGTH);

/** Generate empty or whitespace-only strings */
const emptyPathArb = fc.constantFrom("", " ", "  ", "\t", "  \t  ");

// ─── Tests (Path Validation) ─────────────────────────────────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 16: Installation Path Validation", () => {
  /**
   * Validates: Requirements 7.2
   */

  describe("Property 16a: valid paths are accepted", () => {
    it("paths with valid characters and length <= 200 are accepted", () => {
      fc.assert(
        fc.property(validPathArb, (path) => {
          const result = validateInstallPath(path);
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 16b: paths exceeding 200 characters are rejected with descriptive error", () => {
    it("paths longer than MAX_PATH_LENGTH are rejected", () => {
      fc.assert(
        fc.property(tooLongPathArb, (path) => {
          const result = validateInstallPath(path);
          expect(result).not.toBeNull();
          expect(result).toContain(`${MAX_PATH_LENGTH}`);
          expect(result).toContain(`${path.length}`);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 16c: paths with invalid Windows characters are rejected", () => {
    it('paths containing <, >, ", |, ?, or * are rejected with descriptive error', () => {
      fc.assert(
        fc.property(invalidCharPathArb, (path) => {
          const result = validateInstallPath(path);
          expect(result).not.toBeNull();
          expect(result).toContain("invalid character");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 16d: paths with control characters are rejected", () => {
    it("paths containing control characters (ASCII 0-31) are rejected", () => {
      fc.assert(
        fc.property(controlCharPathArb, (path) => {
          const result = validateInstallPath(path);
          expect(result).not.toBeNull();
          expect(result).toContain("control characters");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 16e: empty or whitespace-only paths are rejected", () => {
    it("empty/whitespace paths are rejected with descriptive error", () => {
      fc.assert(
        fc.property(emptyPathArb, (path) => {
          const result = validateInstallPath(path);
          expect(result).not.toBeNull();
          expect(result).toContain("cannot be empty");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 16f: validation is a total function (never throws)", () => {
    it("returns either null or a non-empty string for any input", () => {
      fc.assert(
        fc.property(fc.string(), (path) => {
          const result = validateInstallPath(path);
          expect(result === null || (typeof result === "string" && result.length > 0)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 16g: length boundary is exact at 200", () => {
    it("a path of exactly 200 characters (valid chars) is accepted", () => {
      fc.assert(
        fc.property(drivePrefix, (drive) => {
          // Build path of exactly 200 chars: "C:\\" + enough 'a' chars
          const prefix = `${drive}\\`;
          const filler = "a".repeat(MAX_PATH_LENGTH - prefix.length);
          const pathStr = prefix + filler;
          expect(pathStr.length).toBe(MAX_PATH_LENGTH);
          expect(validateInstallPath(pathStr)).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it("a path of exactly 201 characters is rejected", () => {
      fc.assert(
        fc.property(drivePrefix, (drive) => {
          const prefix = `${drive}\\`;
          const filler = "a".repeat(MAX_PATH_LENGTH - prefix.length + 1);
          const pathStr = prefix + filler;
          expect(pathStr.length).toBe(MAX_PATH_LENGTH + 1);
          const result = validateInstallPath(pathStr);
          expect(result).not.toBeNull();
          expect(result).toContain(`${MAX_PATH_LENGTH}`);
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ─── Property 18: Installation Logging Completeness ──────────────────────────

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 18: Installation Logging Completeness", () => {
  /**
   * Validates: Requirements 7.9
   */

  describe("Property 18a: every action produces a log entry", () => {
    it("for any sequence of log actions, the logger records exactly one entry per action", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const entries = logger.getEntries();
          expect(entries).toHaveLength(actions.length);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 18b: every entry has a valid ISO 8601 timestamp", () => {
    it("for any sequence of log actions, each log entry timestamp is a valid ISO 8601 string", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const entries = logger.getEntries();
          for (const entry of entries) {
            expect(entry.timestamp).toMatch(ISO8601_REGEX);
            // Also verify it parses to a valid date
            const parsed = new Date(entry.timestamp);
            expect(parsed.getTime()).not.toBeNaN();
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 18c: log level matches the action type", () => {
    it("for any sequence of log actions, each entry's level matches what the action type dictates", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const entries = logger.getEntries();
          for (let i = 0; i < actions.length; i++) {
            expect(entries[i].level).toBe(expectedLevel(actions[i]));
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 18d: phase name is recorded correctly", () => {
    it("for any sequence of log actions, each entry's phase matches the action's phase", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const entries = logger.getEntries();
          for (let i = 0; i < actions.length; i++) {
            expect(entries[i].phase).toBe(actions[i].phase);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 18e: message contains relevant information", () => {
    it("for any sequence of log actions, each entry's message includes the expected content", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const entries = logger.getEntries();
          for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const entry = entries[i];

            switch (action.type) {
              case "phase_start":
                expect(entry.message).toContain(action.phase);
                expect(entry.message).toContain("Phase started");
                break;
              case "phase_complete":
                expect(entry.message).toContain(action.phase);
                expect(entry.message).toContain("Phase completed");
                break;
              case "download":
                expect(entry.message).toContain(action.url);
                expect(entry.details).toBeDefined();
                expect(entry.details!.url).toBe(action.url);
                break;
              case "error":
                expect(entry.message).toBe(action.message);
                break;
              case "info":
                expect(entry.message).toBe(action.message);
                break;
              case "warn":
                expect(entry.message).toBe(action.message);
                break;
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 18f: log entries are in chronological order", () => {
    it("for any sequence of log actions, timestamps are non-decreasing", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const entries = logger.getEntries();
          for (let i = 1; i < entries.length; i++) {
            const prev = new Date(entries[i - 1].timestamp).getTime();
            const curr = new Date(entries[i].timestamp).getTime();
            expect(curr).toBeGreaterThanOrEqual(prev);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 18g: formatted entries contain all structural components", () => {
    it("for any sequence of log actions, each formatted entry includes timestamp, level, phase, and message", () => {
      fc.assert(
        fc.property(logActionsArb, (actions) => {
          const logger = new InstallLogger();
          replayActions(logger, actions);

          const formatted = logger.getFormattedEntries();
          const entries = logger.getEntries();

          expect(formatted).toHaveLength(entries.length);

          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const line = formatted[i];

            // Verify the format matches: [timestamp] [LEVEL] [phase] message
            expect(line).toContain(entry.timestamp);
            expect(line).toContain(entry.level.toUpperCase());
            expect(line).toContain(entry.phase);
            expect(line).toContain(entry.message);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
