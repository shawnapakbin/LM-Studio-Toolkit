/**
 * Feature: windows-installer-setup-exe, Property 13: Version consistency and scheme
 *
 * For all triples of version strings drawn from package.json, tauri.conf.json,
 * and Cargo.toml, the consistency check passes IFF all three are equal AND each
 * follows the `major.minor.patch` scheme with a major segment equal to 5. On
 * failure it names exactly the manifests whose version differs.
 *
 * A manifest differs (equality dimension) iff its version is not the version
 * held by a strict majority (>= 2 of 3) of the manifests:
 *   - all three equal        -> none differ
 *   - exactly one different  -> that one differs
 *   - all three distinct     -> all three differ (no majority to agree on)
 * Scheme violators are always included in the mismatched set.
 *
 * Validates: Requirements 11.1, 11.2, 11.5
 */
import fc from "fast-check";
import {
  MANIFEST_IDS,
  type ManifestId,
  type ManifestVersions,
  checkVersionConsistency,
  isValidScheme,
} from "../../scripts/version-consistency";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A version that is guaranteed to satisfy the `5.minor.patch` scheme. */
const validSchemeVersionArb = fc
  .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }))
  .map(([minor, patch]) => `5.${minor}.${patch}`);

/**
 * A version that violates the `5.minor.patch` scheme. Covers wrong major
 * segment, wrong segment count, `v`-prefixes, pre-release/build metadata, and
 * non-numeric junk.
 */
const invalidSchemeVersionArb = fc.oneof(
  // Wrong major segment (not 5).
  fc
    .tuple(
      fc.nat({ max: 50 }).filter((n) => n !== 5),
      fc.nat({ max: 50 }),
      fc.nat({ max: 50 }),
    )
    .map(([r, b, v]) => `${r}.${b}.${v}`),
  // Too few segments.
  fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map(([a, b]) => `5.${a}`),
  fc.nat({ max: 50 }).map((a) => `5`),
  // Too many segments.
  fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map(([a, b, c]) => `5.${a}.${b}.${c}`),
  // v-prefix.
  fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map(([b, v]) => `v5.${b}.${v}`),
  // Pre-release / build metadata suffix.
  fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map(([b, v]) => `5.${b}.${v}-beta`),
  // Non-numeric junk.
  fc.constantFrom("", "abc", "5.x.0", "5..0", " 5.0.0 x"),
);

/** Any version string, valid or invalid per the scheme. */
const anyVersionArb = fc.oneof(validSchemeVersionArb, invalidSchemeVersionArb);

/** A triple of arbitrary version strings, one per manifest. */
const versionsArb: fc.Arbitrary<ManifestVersions> = fc
  .tuple(anyVersionArb, anyVersionArb, anyVersionArb)
  .map(([pkg, tauri, cargo]) => ({
    "package.json": pkg,
    "tauri.conf.json": tauri,
    "Cargo.toml": cargo,
  }));

// ─── Oracle ──────────────────────────────────────────────────────────────────

/** Independent computation of the expected mismatched-manifest set. */
function expectedMismatched(versions: ManifestVersions): ManifestId[] {
  // Equality dimension: a manifest differs iff it is not the strict-majority value.
  const counts = new Map<string, number>();
  for (const id of MANIFEST_IDS) {
    counts.set(versions[id], (counts.get(versions[id]) ?? 0) + 1);
  }
  let majority: string | undefined;
  for (const [value, count] of counts) {
    if (count >= 2) {
      majority = value;
      break;
    }
  }
  const equalityDiffs =
    majority === undefined
      ? [...MANIFEST_IDS]
      : MANIFEST_IDS.filter((id) => versions[id] !== majority);

  // Scheme dimension: any violator is always mismatched.
  const schemeViolations = MANIFEST_IDS.filter((id) => !isValidScheme(versions[id]));

  const set = new Set<ManifestId>([...equalityDiffs, ...schemeViolations]);
  return MANIFEST_IDS.filter((id) => set.has(id));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: windows-installer-setup-exe, Property 13: Version consistency and scheme", () => {
  /**
   * Validates: Requirements 11.1, 11.2, 11.5
   */

  it("ok is true IFF all three versions are equal AND each follows the 5.minor.patch scheme", () => {
    fc.assert(
      fc.property(versionsArb, (versions) => {
        const result = checkVersionConsistency(versions);

        const allEqual =
          versions["package.json"] === versions["tauri.conf.json"] &&
          versions["tauri.conf.json"] === versions["Cargo.toml"];
        const allValidScheme = MANIFEST_IDS.every((id) => isValidScheme(versions[id]));

        expect(result.ok).toBe(allEqual && allValidScheme);
      }),
      { numRuns: 200 },
    );
  });

  it("mismatchedManifests names exactly the expected set (equality diffs ∪ scheme violators, canonical order)", () => {
    fc.assert(
      fc.property(versionsArb, (versions) => {
        const result = checkVersionConsistency(versions);
        expect(result.mismatchedManifests).toEqual(expectedMismatched(versions));
      }),
      { numRuns: 200 },
    );
  });

  it("mismatchedManifests is empty IFF ok", () => {
    fc.assert(
      fc.property(versionsArb, (versions) => {
        const result = checkVersionConsistency(versions);
        expect(result.mismatchedManifests.length === 0).toBe(result.ok);
      }),
      { numRuns: 200 },
    );
  });

  it("when all three agree on a valid-scheme version, the check passes and nothing is mismatched", () => {
    fc.assert(
      fc.property(validSchemeVersionArb, (version) => {
        const result = checkVersionConsistency({
          "package.json": version,
          "tauri.conf.json": version,
          "Cargo.toml": version,
        });
        expect(result.ok).toBe(true);
        expect(result.mismatchedManifests).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("when exactly one manifest carries a differing valid-scheme version, only that manifest is named", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ManifestId>(...MANIFEST_IDS),
        validSchemeVersionArb,
        validSchemeVersionArb,
        (odd, base, other) => {
          // Ensure the odd-one-out truly differs from the shared majority version.
          fc.pre(base !== other);
          const versions: ManifestVersions = {
            "package.json": base,
            "tauri.conf.json": base,
            "Cargo.toml": base,
          };
          versions[odd] = other;

          const result = checkVersionConsistency(versions);
          expect(result.ok).toBe(false);
          expect(result.mismatchedManifests).toEqual([odd]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
