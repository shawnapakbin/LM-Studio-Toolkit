/**
 * Unit tests for the pure version-consistency logic.
 *
 * Feature: windows-installer-setup-exe (Requirements 11.1, 11.2, 11.5)
 *
 * Covers the pure decision core (`checkVersionConsistency`, `isValidScheme`)
 * and the pure manifest version extractors. The Property 13 test (task 2.5)
 * exercises the same `checkVersionConsistency` core across many inputs.
 */

import {
  type ManifestVersions,
  checkVersionConsistency,
  extractCargoVersion,
  extractJsonVersion,
  isValidScheme,
} from "../../scripts/version-consistency";

describe("isValidScheme", () => {
  it("accepts a strict 5.minor.patch triple", () => {
    expect(isValidScheme("5.1.1")).toBe(true);
    expect(isValidScheme("5.0.0")).toBe(true);
    expect(isValidScheme("5.10.123")).toBe(true);
  });

  it("rejects a major segment other than 5", () => {
    expect(isValidScheme("1.4.0")).toBe(false);
    expect(isValidScheme("3.4.0")).toBe(false);
    expect(isValidScheme("2.4.0")).toBe(false);
  });

  it("rejects non-triple or malformed versions", () => {
    expect(isValidScheme("5.1")).toBe(false);
    expect(isValidScheme("5.1.1.1")).toBe(false);
    expect(isValidScheme("v5.1.1")).toBe(false);
    expect(isValidScheme("5.1.1-beta")).toBe(false);
    expect(isValidScheme("5.x.0")).toBe(false);
    expect(isValidScheme("")).toBe(false);
  });
});

describe("checkVersionConsistency", () => {
  const versions = (pkg: string, tauri: string, cargo: string): ManifestVersions => ({
    "package.json": pkg,
    "tauri.conf.json": tauri,
    "Cargo.toml": cargo,
  });

  it("passes when all three are equal and follow the scheme", () => {
    const result = checkVersionConsistency(versions("5.1.1", "5.1.1", "5.1.1"));
    expect(result.ok).toBe(true);
    expect(result.mismatchedManifests).toEqual([]);
  });

  it("names exactly the one manifest that differs", () => {
    const result = checkVersionConsistency(versions("5.1.1", "5.1.1", "5.1.0"));
    expect(result.ok).toBe(false);
    expect(result.mismatchedManifests).toEqual(["Cargo.toml"]);
  });

  it("names exactly the differing manifest regardless of position", () => {
    const result = checkVersionConsistency(versions("5.2.0", "5.1.1", "5.1.1"));
    expect(result.ok).toBe(false);
    expect(result.mismatchedManifests).toEqual(["package.json"]);
  });

  it("names all three when all versions are distinct", () => {
    const result = checkVersionConsistency(versions("5.1.0", "5.2.0", "5.3.0"));
    expect(result.ok).toBe(false);
    expect(result.mismatchedManifests).toEqual(["package.json", "tauri.conf.json", "Cargo.toml"]);
  });

  it("fails when all equal but the scheme is violated (major != 5)", () => {
    const result = checkVersionConsistency(versions("1.4.0", "1.4.0", "1.4.0"));
    expect(result.ok).toBe(false);
    expect(result.mismatchedManifests).toEqual(["package.json", "tauri.conf.json", "Cargo.toml"]);
  });

  it("reports both an equality diff and a scheme violation on the same manifest set", () => {
    // package.json/tauri agree on a scheme-invalid version; Cargo differs.
    const result = checkVersionConsistency(versions("3.4.0", "3.4.0", "5.1.1"));
    expect(result.ok).toBe(false);
    // The majority version (3.4.0) violates the scheme, and Cargo differs from it.
    expect(result.mismatchedManifests).toEqual(["package.json", "tauri.conf.json", "Cargo.toml"]);
  });
});

describe("manifest version extractors", () => {
  it("extracts a version from a JSON manifest", () => {
    expect(extractJsonVersion('{"version":"5.1.1","name":"x"}')).toBe("5.1.1");
  });

  it("throws when a JSON manifest has no string version", () => {
    expect(() => extractJsonVersion('{"name":"x"}')).toThrow();
  });

  it("extracts the [package] version from a Cargo.toml", () => {
    const cargo = [
      "[package]",
      'name = "llm-toolkit-installer"',
      'version = "5.1.1"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'tauri = { version = "2" }',
    ].join("\n");
    expect(extractCargoVersion(cargo)).toBe("5.1.1");
  });

  it("does not pick up a dependency version outside [package]", () => {
    const cargo = [
      "[package]",
      'version = "5.7.0"',
      "",
      "[dependencies]",
      'serde = { version = "1.0.99" }',
    ].join("\n");
    expect(extractCargoVersion(cargo)).toBe("5.7.0");
  });
});
