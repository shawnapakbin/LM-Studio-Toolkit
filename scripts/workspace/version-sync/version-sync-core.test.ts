// Feature: dependency-refresh-node24
// Task 9.1 — Unit tests for the pure repo-wide version-sync + consistency core.
//
// **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9**
//
// These unit tests pin the concrete behaviour of the pure `version-sync-core`
// functions the CLI (`sync-repo-version.ts`) and the Property 4 test (task 9.2)
// both consume:
//   - extraction reads the version from each file kind (package.json /
//     tauri.conf.json JSON, Cargo.toml [package], README `**Version**:` line),
//   - writing sets the target byte-identically while preserving surrounding
//     bytes (indentation, trailing newline, Cargo deps, README hard-break),
//   - writing is idempotent (a file already at the target is returned unchanged),
//   - the consistency check reports failure iff some file differs, listing
//     exactly the divergent files (Req 9.8/9.9).
//
// The core is driven directly (no mocks) over representative fixtures mirroring
// the repo's real file shapes.

import {
  applyRepoSync,
  checkRepoVersions,
  extractCargoVersion,
  extractJsonVersion,
  extractReadmeVersion,
  extractVersion,
  fileKind,
  isVersionTriple,
  setCargoVersion,
  setJsonVersion,
  setReadmeVersion,
  setVersion,
  type VersionFileId,
} from "./version-sync-core";

// ── Fixtures mirroring the repo's real file shapes ───────────────────────────

const PKG_JSON = `{\n  "name": "lm-studio-toolkit",\n  "version": "5.3.0",\n  "private": true\n}\n`;

const TAURI_CONF = `{\n  "productName": "LLM Toolkit Installer",\n  "version": "5.3.0",\n  "identifier": "com.llmtoolkit.installer"\n}\n`;

// A Cargo.toml with a [package] version AND a dependency `version = "..."` that
// must NOT be touched by the extractor or writer.
const CARGO_TOML = `[package]
name = "llm-toolkit-installer"
version = "5.3.0"
edition = "2021"

[dependencies]
tauri = { version = "2.9", features = [] }
`;

// README states the version on a `**Version**: x.y.z` line with a trailing
// Markdown hard-break (two spaces) that must be preserved.
const README = `# LLM Toolkit\n\n**Version**: 5.2.0  \n**Status**: Phase 0\n`;

describe("version-sync-core (Feature: dependency-refresh-node24, Task 9.1)", () => {
  describe("isVersionTriple", () => {
    it("accepts strict MAJOR.MINOR.PATCH triples", () => {
      expect(isVersionTriple("5.3.0")).toBe(true);
      expect(isVersionTriple("0.0.0")).toBe(true);
      expect(isVersionTriple(" 10.20.30 ")).toBe(true);
    });

    it("rejects non-triples (prefixed, pre-release, wrong arity)", () => {
      expect(isVersionTriple("v5.3.0")).toBe(false);
      expect(isVersionTriple("5.3.0-rc.1")).toBe(false);
      expect(isVersionTriple("5.3")).toBe(false);
      expect(isVersionTriple("5.3.0.1")).toBe(false);
      expect(isVersionTriple("")).toBe(false);
    });
  });

  describe("fileKind", () => {
    it("classifies each VersionFileId to its parser/writer", () => {
      expect(fileKind("root/package.json")).toBe("json");
      expect(fileKind("workspace:CLI/package.json")).toBe("json");
      expect(fileKind("Installer/src-tauri/tauri.conf.json")).toBe("json");
      expect(fileKind("Installer/src-tauri/Cargo.toml")).toBe("cargo");
      expect(fileKind("README.md")).toBe("readme");
    });
  });

  describe("extraction", () => {
    it("reads the version from JSON manifests (package.json / tauri.conf.json)", () => {
      expect(extractJsonVersion(PKG_JSON)).toBe("5.3.0");
      expect(extractJsonVersion(TAURI_CONF)).toBe("5.3.0");
    });

    it("reads the [package] version from Cargo.toml, not a dependency version", () => {
      expect(extractCargoVersion(CARGO_TOML)).toBe("5.3.0");
    });

    it("reads the README `**Version**:` line", () => {
      expect(extractReadmeVersion(README)).toBe("5.2.0");
    });

    it("extractVersion dispatches by kind", () => {
      expect(extractVersion("json", PKG_JSON)).toBe("5.3.0");
      expect(extractVersion("cargo", CARGO_TOML)).toBe("5.3.0");
      expect(extractVersion("readme", README)).toBe("5.2.0");
    });

    it("throws on a JSON manifest without a string version", () => {
      expect(() => extractJsonVersion(`{"name":"x"}`)).toThrow();
    });

    it("throws on a README without a version line", () => {
      expect(() => extractReadmeVersion("# no version here")).toThrow();
    });
  });

  describe("writing is byte-identical and preserves surrounding bytes", () => {
    it("setJsonVersion updates version, keeps 2-space indent + trailing newline", () => {
      const out = setJsonVersion(PKG_JSON, "6.0.0");
      expect(extractJsonVersion(out)).toBe("6.0.0");
      expect(out.endsWith("\n")).toBe(true);
      expect(out).toContain(`  "name": "lm-studio-toolkit"`);
      expect(out).toContain(`  "version": "6.0.0"`);
    });

    it("setCargoVersion updates only the [package] version, leaving deps intact", () => {
      const out = setCargoVersion(CARGO_TOML, "6.0.0");
      expect(extractCargoVersion(out)).toBe("6.0.0");
      // The dependency version must be untouched.
      expect(out).toContain(`tauri = { version = "2.9", features = [] }`);
      expect(out).toContain(`version = "6.0.0"`);
    });

    it("setReadmeVersion updates the version token, preserving the hard-break spaces", () => {
      const out = setReadmeVersion(README, "6.0.0");
      expect(extractReadmeVersion(out)).toBe("6.0.0");
      // The two trailing spaces after the version (Markdown hard break) survive.
      expect(out).toContain("**Version**: 6.0.0  \n");
    });

    it("setVersion dispatches by kind", () => {
      expect(extractVersion("json", setVersion("json", PKG_JSON, "7.1.2"))).toBe("7.1.2");
      expect(extractVersion("cargo", setVersion("cargo", CARGO_TOML, "7.1.2"))).toBe("7.1.2");
      expect(extractVersion("readme", setVersion("readme", README, "7.1.2"))).toBe("7.1.2");
    });
  });

  describe("writing is idempotent (running twice is a no-op)", () => {
    it("returns byte-identical content when the file already reports the target", () => {
      // Normalise each fixture to the writer's own output first, then assert a
      // second write with the same target changes nothing.
      const jsonAt = setJsonVersion(PKG_JSON, "6.0.0");
      expect(setJsonVersion(jsonAt, "6.0.0")).toBe(jsonAt);

      const cargoAt = setCargoVersion(CARGO_TOML, "6.0.0");
      expect(setCargoVersion(cargoAt, "6.0.0")).toBe(cargoAt);

      const readmeAt = setReadmeVersion(README, "6.0.0");
      expect(setReadmeVersion(readmeAt, "6.0.0")).toBe(readmeAt);
    });

    it("Cargo/README single-line writers leave already-synced files byte-identical", () => {
      // CARGO_TOML / README already at their own version -> writing that same
      // version must not change a single byte.
      expect(setCargoVersion(CARGO_TOML, "5.3.0")).toBe(CARGO_TOML);
      expect(setReadmeVersion(README, "5.2.0")).toBe(README);
    });
  });

  describe("applyRepoSync writes the target into every file and is idempotent", () => {
    const contents: Record<string, string> = {
      "root/package.json": PKG_JSON,
      "workspace:CLI/package.json": PKG_JSON,
      "Installer/src-tauri/Cargo.toml": CARGO_TOML,
      "Installer/src-tauri/tauri.conf.json": TAURI_CONF,
      "README.md": README,
    };

    it("every file reports the byte-identical target after sync", () => {
      const synced = applyRepoSync("6.0.0", contents);
      for (const id of Object.keys(synced) as VersionFileId[]) {
        expect(extractVersion(fileKind(id), synced[id])).toBe("6.0.0");
      }
    });

    it("a second sync with the same target is a byte-for-byte no-op", () => {
      const once = applyRepoSync("6.0.0", contents);
      const twice = applyRepoSync("6.0.0", once);
      expect(twice).toEqual(once);
    });
  });

  describe("checkRepoVersions reports mismatches (Req 9.8 / 9.9)", () => {
    it("ok when every file reports the byte-identical target", () => {
      const result = checkRepoVersions("5.3.0", {
        "root/package.json": "5.3.0",
        "workspace:CLI/package.json": "5.3.0",
        "Installer/src-tauri/Cargo.toml": "5.3.0",
        "Installer/src-tauri/tauri.conf.json": "5.3.0",
        "README.md": "5.3.0",
      });
      expect(result.ok).toBe(true);
      expect(result.target).toBe("5.3.0");
      expect(result.mismatched).toEqual([]);
    });

    it("lists exactly the divergent files, sorted", () => {
      const result = checkRepoVersions("5.3.0", {
        "root/package.json": "5.3.0",
        "workspace:CLI/package.json": "5.3.0",
        "Installer/src-tauri/Cargo.toml": "5.2.0",
        "Installer/src-tauri/tauri.conf.json": "5.3.0",
        "README.md": "5.2.0",
      });
      expect(result.ok).toBe(false);
      expect(result.mismatched).toEqual(["Installer/src-tauri/Cargo.toml", "README.md"]);
    });

    it("reports every file when all diverge from the target", () => {
      const snapshot: Record<string, string> = {
        "root/package.json": "5.3.0",
        "README.md": "5.2.0",
      };
      const result = checkRepoVersions("9.9.9", snapshot);
      expect(result.ok).toBe(false);
      expect(result.mismatched.sort()).toEqual(["README.md", "root/package.json"]);
    });
  });
});
