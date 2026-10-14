/**
 * Bugfix: mcp-shared-module-resolution-fix — task 3.3.
 *
 * Unit coverage for the generator change that provisions the two `@shared/*`
 * packages via local `file:` tarballs (design → Fix → Changes Required step 3;
 * Fix Checking test case 1):
 *
 *   - `computeFlatManifest` emits BOTH `@shared/types` and `@shared/config` as
 *     direct dependencies whose specifier is the version-derived sanctioned
 *     tarball reference (`file:./<stem>-<version>.tgz`) — never hardcoded.
 *   - `@shared/config` is SEEDED even though no tool declares it (prong 2 of the
 *     bug), so its registry transitive deps (`yaml`, `zod`) are hoisted into the
 *     flat manifest.
 *   - `@shared/types` carries no registry deps to hoist (its manifest declares
 *     none) — it is provisioned purely as a `file:` entry.
 *   - `productionSafetyProblems` returns EMPTY for the two sanctioned `@shared/*`
 *     `file:` entries, while STILL flagging every other `file:`/`*`/workspace
 *     specifier and every other workspace-internal name — and flagging a
 *     `@shared/*` name carrying a NON-sanctioned specifier.
 *   - The non-`@shared/*` registry-dep subset and the `zod` `$`-override are
 *     unchanged by the fix (preservation, Req 3.3).
 *
 * These exercise the pure core through its `ManifestReader` seam — no disk, no
 * network, no lockfile resolve — so `yaml` hoisting is driven deterministically
 * from an in-memory `@shared/config` manifest.
 *
 * Validates: Requirements 2.1, 2.2, 3.3
 */

import {
  computeFlatManifest,
  type GeneratedManifest,
  isSanctionedSharedTarballSpecifier,
  type ManifestReader,
  productionSafetyProblems,
  type RawManifest,
  sharedTarballFileSpecifier,
} from "../../scripts/generate-production-manifest";

/**
 * An in-memory manifest set modeling the REAL repo shape the generator reads:
 *   - a tool (`mcp/common`) that declares `@shared/types` via a `file:`
 *     specifier (so the drop/`file:` path is exercised);
 *   - another tool (`Terminal`) with a plain registry dep;
 *   - the `@shared/config` package carrying `yaml` + `zod` (its real deps),
 *     reachable only because the generator SEEDS it (no tool declares it);
 *   - the `@shared/types` package (`shared`) with NO dependencies.
 */
function makeReader(overrides: Record<string, RawManifest | undefined> = {}): ManifestReader {
  const base: Record<string, RawManifest> = {
    ".": { name: "root", version: "5.4.3", workspaces: [] } as RawManifest,
    Terminal: { name: "terminal", dependencies: { "@modelcontextprotocol/sdk": "^1.30.1" } },
    "mcp/common": {
      name: "common",
      dependencies: { "@shared/types": "file:../../shared", express: "^4.22.3" },
    },
    // `@shared/config` is NOT declared by any tool — it must be SEEDED.
    "shared/config": {
      name: "@shared/config",
      dependencies: { yaml: "^2.9.1", zod: "^3.25.76" },
    },
    // `@shared/types` has no registry deps to hoist.
    shared: { name: "@shared/types" },
  };
  const merged: Record<string, RawManifest | undefined> = { ...base, ...overrides };
  return {
    read(dir: string): RawManifest | undefined {
      return merged[dir];
    },
  };
}

function generate(version: string, overrides?: Record<string, string>): GeneratedManifest {
  return computeFlatManifest(makeReader(), {
    name: "llm-toolkit-runtime",
    version,
    overrides,
  });
}

describe("task 3.3 — @shared/* emitted as version-derived file: tarball deps", () => {
  it("emits BOTH @shared/* names with the sanctioned file: specifier", () => {
    const gen = generate("5.4.3");
    expect(gen.manifest.dependencies["@shared/types"]).toBe("file:./shared-types-5.4.3.tgz");
    expect(gen.manifest.dependencies["@shared/config"]).toBe("file:./shared-config-5.4.3.tgz");
  });

  it("derives the file: tarball name from the manifest version (no hardcoded drift)", () => {
    const gen = generate("9.9.9-rc.1");
    expect(gen.manifest.dependencies["@shared/types"]).toBe("file:./shared-types-9.9.9-rc.1.tgz");
    expect(gen.manifest.dependencies["@shared/config"]).toBe("file:./shared-config-9.9.9-rc.1.tgz");
    // The emitted specifier equals the shared helper for the same version.
    expect(gen.manifest.dependencies["@shared/types"]).toBe(
      sharedTarballFileSpecifier("shared-types", "9.9.9-rc.1"),
    );
  });

  it("hoists @shared/config's registry transitive deps (notably yaml and zod)", () => {
    const gen = generate("5.4.3");
    // `yaml` is a @shared/config-only dep, invisible to the UNFIXED generator
    // (prong 2); seeding @shared/config brings it in.
    expect(gen.manifest.dependencies.yaml).toBe("^2.9.1");
    expect(Object.hasOwn(gen.manifest.dependencies, "zod")).toBe(true);
  });

  it("keeps the non-@shared/* registry deps declared by the tools (preservation)", () => {
    const gen = generate("5.4.3");
    expect(gen.manifest.dependencies["@modelcontextprotocol/sdk"]).toBe("^1.30.1");
    expect(gen.manifest.dependencies.express).toBe("^4.22.3");
  });

  it("dependencies stay key-sorted after injecting the two @shared/* names", () => {
    const gen = generate("5.4.3");
    const keys = Object.keys(gen.manifest.dependencies);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    // The two @shared/* names are present in the sorted set.
    expect(keys).toContain("@shared/types");
    expect(keys).toContain("@shared/config");
  });
});

describe("task 3.3 — productionSafetyProblems allows exactly the two sanctioned entries", () => {
  it("returns EMPTY for a manifest with the two sanctioned @shared/* file: entries", () => {
    const gen = generate("5.4.3");
    expect(productionSafetyProblems(gen)).toEqual([]);
  });

  it("carries the zod override as a $zod self-reference and is still safe", () => {
    const gen = generate("5.4.3", { zod: "3.25.76" });
    expect(gen.manifest.overrides).toEqual({ zod: "$zod" });
    expect(gen.manifest.dependencies.zod).toBe("3.25.76");
    expect(productionSafetyProblems(gen)).toEqual([]);
  });

  it("still FLAGS a non-@shared/* dependency carrying a file: specifier", () => {
    const gen = generate("5.4.3");
    // Inject a rogue file: dep that is NOT one of the sanctioned @shared/* names.
    (gen.manifest.dependencies as Record<string, string>)["rogue-pkg"] = "file:./rogue.tgz";
    const problems = productionSafetyProblems(gen);
    expect(problems.some((p) => p.includes("rogue-pkg"))).toBe(true);
  });

  it("still FLAGS a workspace-internal llm-toolkit-* name if one leaks in", () => {
    const gen = generate("5.4.3");
    (gen.manifest.dependencies as Record<string, string>)["llm-toolkit-calculator"] = "1.0.0";
    const problems = productionSafetyProblems(gen);
    expect(problems.some((p) => p.includes("llm-toolkit-calculator"))).toBe(true);
  });

  it("FLAGS a @shared/* name carrying a NON-sanctioned specifier (wrong version / `*`)", () => {
    const gen = generate("5.4.3");
    // A `@shared/*` entry pointing at the WRONG version is not sanctioned.
    (gen.manifest.dependencies as Record<string, string>)["@shared/types"] =
      "file:./shared-types-9.9.9.tgz";
    const problemsWrongVersion = productionSafetyProblems(gen);
    expect(problemsWrongVersion.some((p) => p.includes("@shared/types"))).toBe(true);

    // A `*` specifier for a @shared/* name is likewise rejected.
    const gen2 = generate("5.4.3");
    (gen2.manifest.dependencies as Record<string, string>)["@shared/config"] = "*";
    const problemsWildcard = productionSafetyProblems(gen2);
    expect(problemsWildcard.some((p) => p.includes("@shared/config"))).toBe(true);
  });
});

describe("task 3.3 — isSanctionedSharedTarballSpecifier", () => {
  it("accepts only the exact version-derived specifier for a known @shared/* name", () => {
    expect(
      isSanctionedSharedTarballSpecifier("@shared/types", "file:./shared-types-5.4.3.tgz", "5.4.3"),
    ).toBe(true);
    expect(
      isSanctionedSharedTarballSpecifier(
        "@shared/config",
        "file:./shared-config-5.4.3.tgz",
        "5.4.3",
      ),
    ).toBe(true);
  });

  it("rejects a wrong version, a swapped stem, a non-file: spec, and an unknown name", () => {
    // Wrong version.
    expect(
      isSanctionedSharedTarballSpecifier("@shared/types", "file:./shared-types-9.9.9.tgz", "5.4.3"),
    ).toBe(false);
    // Swapped stem (config spec under the types name).
    expect(
      isSanctionedSharedTarballSpecifier(
        "@shared/types",
        "file:./shared-config-5.4.3.tgz",
        "5.4.3",
      ),
    ).toBe(false);
    // Not a file: specifier.
    expect(isSanctionedSharedTarballSpecifier("@shared/types", "*", "5.4.3")).toBe(false);
    // Unknown (non-@shared/*) name is never sanctioned.
    expect(
      isSanctionedSharedTarballSpecifier("rogue-pkg", "file:./shared-types-5.4.3.tgz", "5.4.3"),
    ).toBe(false);
  });
});
