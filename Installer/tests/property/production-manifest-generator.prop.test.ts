/**
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.8 (Part B / B2)
 * Property: Flat production manifest generator — pure-core invariants.
 *
 * For ARBITRARY sets of tool manifests (a mix of registry-published
 * `dependencies`, workspace-internal `file:`/`*`/`workspace:` specifiers, and
 * workspace-internal dependency NAMES) plus a root `overrides`/`zod` pin, the
 * generator's pure core (`computeFlatManifest` + `normalizeOverrides` +
 * `serializeManifest`, validated by `productionSafetyProblems`) must emit a
 * production-SAFE flat manifest:
 *
 *   1. NO `scripts` block        (design Fix Impl §1 / Req 2.2 — no prepare/husky).
 *   2. NO `engines` field        (design Fix Impl §1 / Req 2.5 — no EBADENGINE).
 *   3. NO `file:`/`*`/`workspace:` specifier reaches the end user.
 *   4. NO workspace-internal dependency NAME (`@shared/types`, `llm-toolkit-*`).
 *   5. Each package is deduped to a SINGLE compatible range (the highest
 *      declared minimum version across all consumers).
 *   6. `productionSafetyProblems(gen)` is EMPTY (the generator's own abort gate).
 *   7. Every registry-published dep declared by some tool survives into the flat
 *      list (nothing published is silently dropped).
 *
 * This complements the existing drift/byte-identical unit coverage in
 * `tests/unit/verify-production-manifest.test.ts` (which pins the REAL committed
 * manifest) by exercising the planner across the whole generated INPUT space
 * through its `ManifestReader` seam — no disk, no network, no lockfile resolve.
 *
 * Validates: Requirements 2.1, 2.2, 2.5
 */

import fc from "fast-check";

import {
  CANONICAL_TOOL_PACKAGE_DIRS,
  computeFlatManifest,
  isWorkspaceInternalName,
  isWorkspaceInternalSpecifier,
  type ManifestReader,
  pickCompatibleRange,
  productionSafetyProblems,
  type RawManifest,
  serializeManifest,
  WORKSPACE_INTERNAL_PACKAGE_DIRS,
} from "../../scripts/generate-production-manifest";

const FEATURE_TAG =
  "Bugfix: runtimes-npm-install-nonzero-exit, Property: flat production manifest generator pure-core invariants";

// ─── Generators ──────────────────────────────────────────────────────────────

/** A registry-published package name (optionally scoped), never workspace-internal. */
const registryPackageNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{1,8}$/), { nil: undefined }),
    fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/),
  )
  .map(([scope, name]) => (scope === undefined ? name : `@${scope}/${name}`))
  // Exclude anything the generator would (correctly) treat as internal by NAME.
  .filter((n) => !isWorkspaceInternalName(n));

/** A concrete caret range like `^1.2.3`. */
const caretRangeArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 0, max: 20 }),
    fc.integer({ min: 0, max: 40 }),
    fc.integer({ min: 0, max: 40 }),
  )
  .map(([a, b, c]) => `^${a}.${b}.${c}`);

/** A workspace-internal specifier the generator must drop/hoist. */
const workspaceInternalSpecifierArb: fc.Arbitrary<string> = fc.constantFrom(
  "*",
  "file:../shared",
  "file:../Observability",
  "workspace:*",
);

/** A single registry dependency entry `[name, range]`. */
const registryDepArb: fc.Arbitrary<[string, string]> = fc.tuple(
  registryPackageNameArb,
  caretRangeArb,
);

/**
 * A tool manifest: a bag of registry deps plus optionally some
 * workspace-internal specifiers (by a real internal NAME) that must be
 * dropped/hoisted and never surface.
 */
const toolManifestArb: fc.Arbitrary<RawManifest> = fc
  .tuple(
    fc.array(registryDepArb, { minLength: 0, maxLength: 6 }),
    fc.subarray(["@shared/types", "llm-toolkit-observability", "llm-toolkit-calculator"], {
      minLength: 0,
      maxLength: 3,
    }),
    fc.array(workspaceInternalSpecifierArb, { minLength: 0, maxLength: 3 }),
  )
  .map(([registryDeps, internalNames, internalSpecs]) => {
    const dependencies: Record<string, string> = {};
    for (const [name, range] of registryDeps) {
      dependencies[name] = range;
    }
    // Internal deps declared by NAME (with a file:/* specifier) — must be dropped.
    internalNames.forEach((name, i) => {
      dependencies[name] = internalSpecs[i] ?? "*";
    });
    return { dependencies } satisfies RawManifest;
  });

/**
 * Build an in-memory {@link ManifestReader} that answers for the canonical tool
 * dirs (seeded with the arbitrary manifests) and the workspace-internal dirs
 * (each contributing a published dep whose range is also arbitrary) and returns
 * undefined for anything else — exercising the missing-manifest path too.
 */
function makeReader(
  toolManifests: Record<string, RawManifest>,
  internalManifests: Record<string, RawManifest>,
): ManifestReader {
  return {
    read(repoRelDir: string): RawManifest | undefined {
      return toolManifests[repoRelDir] ?? internalManifests[repoRelDir];
    },
  };
}

// ─── Properties ────────────────────────────────────────────────────────────

describe(FEATURE_TAG, () => {
  it("emits a production-safe flat manifest for arbitrary tool-manifest sets", () => {
    fc.assert(
      fc.property(
        // One manifest per canonical tool dir (a subset may be present).
        fc.dictionary(fc.constantFrom(...CANONICAL_TOOL_PACKAGE_DIRS), toolManifestArb),
        // A hoistable published dep for each workspace-internal dir.
        fc.dictionary(
          fc.constantFrom(...WORKSPACE_INTERNAL_PACKAGE_DIRS),
          fc.record({
            dependencies: fc
              .array(registryDepArb, { minLength: 0, maxLength: 3 })
              .map((pairs) => Object.fromEntries(pairs)),
          }),
        ),
        // An arbitrary root overrides block (e.g. the zod pin).
        fc.dictionary(registryPackageNameArb, caretRangeArb, { maxKeys: 3 }),
        (toolManifests, internalRaw, overrides) => {
          const internalManifests: Record<string, RawManifest> = internalRaw;
          const reader = makeReader(toolManifests, internalManifests);

          const gen = computeFlatManifest(reader, {
            name: "llm-toolkit-runtime",
            version: "1.2.3",
            overrides,
          });

          const emitted = gen.manifest as Record<string, unknown>;

          // (1) + (2): no scripts, no engines.
          expect("scripts" in emitted).toBe(false);
          expect("engines" in emitted).toBe(false);
          // Always marked private + carries the requested identity.
          expect(gen.manifest.private).toBe(true);
          expect(gen.manifest.name).toBe("llm-toolkit-runtime");

          // (3) + (4): no unresolvable specifier, no internal name survives.
          for (const [name, spec] of Object.entries(gen.manifest.dependencies)) {
            expect(isWorkspaceInternalSpecifier(spec)).toBe(false);
            expect(isWorkspaceInternalName(name)).toBe(false);
          }

          // (6): the generator's own abort gate is clean.
          expect(productionSafetyProblems(gen)).toEqual([]);

          // (5): one range per package (dependencies is a plain object → keys
          // are unique by construction) AND the kept range is the dedup winner.
          const names = Object.keys(gen.manifest.dependencies);
          expect(new Set(names).size).toBe(names.length);

          // (7): every registry-published dep declared by SOME tool survives,
          // unless it was promoted into `overrides` (pinned + $-referenced).
          const published = new Map<string, string>();
          for (const dir of CANONICAL_TOOL_PACKAGE_DIRS) {
            const m = toolManifests[dir];
            if (!m?.dependencies) continue;
            for (const [name, spec] of Object.entries(m.dependencies)) {
              if (isWorkspaceInternalSpecifier(spec) || isWorkspaceInternalName(name)) continue;
              const prior = published.get(name);
              published.set(name, prior === undefined ? spec : pickCompatibleRange(prior, spec));
            }
          }
          for (const [name, expectedRange] of published) {
            expect(Object.hasOwn(gen.manifest.dependencies, name)).toBe(true);
            if (!Object.hasOwn(overrides, name)) {
              // Not override-pinned: must keep the deduped compatible range.
              expect(gen.manifest.dependencies[name]).toBe(expectedRange);
            }
          }

          // Serialization is deterministic + newline-terminated (drift-stable).
          const text = serializeManifest(gen);
          expect(text.endsWith("\n")).toBe(true);
          expect(JSON.parse(text)).toEqual(gen.manifest);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("promotes an override that targets a direct dep to a $-self-reference and pins it", () => {
    // Narrows the overrides path: when an override key is also a direct
    // dependency, normalizeOverrides pins the dep to the concrete override
    // version and rewrites the override to `$<name>` (npm EOVERRIDE escape).
    fc.assert(
      fc.property(
        registryPackageNameArb,
        caretRangeArb,
        caretRangeArb,
        (pkg, depRange, ovRange) => {
          const reader = makeReader({ Terminal: { dependencies: { [pkg]: depRange } } }, {});
          const gen = computeFlatManifest(reader, { overrides: { [pkg]: ovRange } });

          // The direct dep is pinned to the override's concrete version…
          expect(gen.manifest.dependencies[pkg]).toBe(ovRange);
          // …and the override is rewritten to the self-reference form.
          expect(gen.manifest.overrides?.[pkg]).toBe(`$${pkg}`);
          // Still production-safe.
          expect(productionSafetyProblems(gen)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("drops/hoists every workspace-internal dep so nothing unresolvable leaks", () => {
    // Focused on invariants (3)+(4): a tool that depends ONLY on
    // workspace-internal packages (by name + file:/* specifier) must yield a
    // flat manifest whose deps are exactly the hoisted registry deps — never
    // the internal names/specifiers themselves.
    fc.assert(
      fc.property(fc.array(registryDepArb, { minLength: 1, maxLength: 4 }), (hoistable) => {
        const reader = makeReader(
          { Terminal: { dependencies: { "@shared/types": "file:../shared", observability: "*" } } },
          {
            // `@shared/types` resolves to the `shared` dir, which carries the
            // hoistable published deps.
            shared: { dependencies: Object.fromEntries(hoistable) },
          },
        );
        const gen = computeFlatManifest(reader, {});

        expect(Object.hasOwn(gen.manifest.dependencies, "@shared/types")).toBe(false);
        for (const name of Object.keys(gen.manifest.dependencies)) {
          expect(isWorkspaceInternalName(name)).toBe(false);
        }
        // The hoisted published deps surfaced.
        for (const [name] of hoistable) {
          expect(Object.hasOwn(gen.manifest.dependencies, name)).toBe(true);
        }
        expect(productionSafetyProblems(gen)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
