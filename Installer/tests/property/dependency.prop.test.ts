/**
 * Property 13: Dependency Version Detection
 *
 * For any combination of installed/missing/outdated Node.js and Git versions
 * on a Windows system, the Installer's dependency detection logic must correctly
 * classify each dependency as "present and sufficient" (version >= minimum)
 * or "needs download" (missing or version < minimum).
 *
 * Validates: Requirements 6.3, 6.4
 */
import fc from "fast-check";
import {
  type SemVer,
  classifyDependency,
  extractVersionFromOutput,
  parseSemVer,
  satisfiesMinimum,
} from "../helpers/version";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Arbitrary for valid semver components */
const semverComponentArb = fc.integer({ min: 0, max: 999 });

/** Arbitrary for a valid SemVer tuple */
const semverArb = fc
  .tuple(semverComponentArb, semverComponentArb, semverComponentArb)
  .map(([major, minor, patch]): SemVer => ({ major, minor, patch }));

/** Format a SemVer as a version string */
function formatVersion(ver: SemVer): string {
  return `${ver.major}.${ver.minor}.${ver.patch}`;
}

/** Compare two SemVer objects: returns negative if a < b, 0 if equal, positive if a > b */
function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 13: Dependency Version Detection", () => {
  /**
   * Validates: Requirements 6.3, 6.4
   */

  describe("Property 13a: version >= minimum classifies as present_sufficient", () => {
    it("for any valid version >= minimum, classifyDependency returns 'present_sufficient'", () => {
      fc.assert(
        fc.property(semverArb, semverArb, (current, minimum) => {
          // Ensure current >= minimum by adjusting current if needed
          const adjusted: SemVer = {
            major: minimum.major + current.major,
            minor: current.major === 0 ? minimum.minor + current.minor : current.minor,
            patch:
              current.major === 0 && current.minor === 0
                ? minimum.patch + current.patch
                : current.patch,
          };

          const result = classifyDependency(formatVersion(adjusted), formatVersion(minimum));
          expect(result).toBe("present_sufficient");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 13b: version < minimum classifies as needs_download", () => {
    it("for any valid version < minimum, classifyDependency returns 'needs_download'", () => {
      fc.assert(
        fc.property(semverArb, fc.integer({ min: 1, max: 999 }), (base, increment) => {
          // Create a minimum that is strictly greater than base
          // by incrementing one component
          const minimum: SemVer = {
            major: base.major + increment,
            minor: base.minor,
            patch: base.patch,
          };

          const result = classifyDependency(formatVersion(base), formatVersion(minimum));
          expect(result).toBe("needs_download");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 13c: null version classifies as needs_download", () => {
    it("when no version is detected (null), classifyDependency returns 'needs_download'", () => {
      fc.assert(
        fc.property(semverArb, (minimum) => {
          const result = classifyDependency(null, formatVersion(minimum));
          expect(result).toBe("needs_download");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 13d: version parsing handles Node.js and Git formats", () => {
    it("parses Node.js format 'vX.Y.Z' correctly", () => {
      fc.assert(
        fc.property(semverArb, (ver) => {
          const output = `v${ver.major}.${ver.minor}.${ver.patch}\n`;
          const extracted = extractVersionFromOutput(output);
          expect(extracted).toBe(formatVersion(ver));
        }),
        { numRuns: 100 },
      );
    });

    it("parses Git format 'git version X.Y.Z.windows.N' correctly", () => {
      fc.assert(
        fc.property(semverArb, fc.integer({ min: 1, max: 10 }), (ver, windowsBuild) => {
          const output = `git version ${ver.major}.${ver.minor}.${ver.patch}.windows.${windowsBuild}\n`;
          const extracted = extractVersionFromOutput(output);
          expect(extracted).toBe(formatVersion(ver));
        }),
        { numRuns: 100 },
      );
    });

    it("parseSemVer handles v-prefix", () => {
      fc.assert(
        fc.property(semverArb, (ver) => {
          const parsed = parseSemVer(`v${ver.major}.${ver.minor}.${ver.patch}`);
          expect(parsed).toEqual(ver);
        }),
        { numRuns: 100 },
      );
    });

    it("parseSemVer handles trailing suffixes (e.g., .windows.1)", () => {
      fc.assert(
        fc.property(semverArb, fc.integer({ min: 1, max: 99 }), (ver, suffix) => {
          const parsed = parseSemVer(`${ver.major}.${ver.minor}.${ver.patch}.windows.${suffix}`);
          expect(parsed).toEqual(ver);
        }),
        { numRuns: 100 },
      );
    });

    it("parseSemVer returns null for strings with fewer than 3 parts", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 999 }),
          fc.integer({ min: 0, max: 999 }),
          (major, minor) => {
            expect(parseSemVer(`${major}.${minor}`)).toBeNull();
            expect(parseSemVer(`${major}`)).toBeNull();
            expect(parseSemVer("")).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 13e: version comparison is transitive", () => {
    it("if A >= B and B >= C then A >= C (transitivity)", () => {
      fc.assert(
        fc.property(semverArb, semverArb, semverArb, (a, b, c) => {
          const aGeB = satisfiesMinimum(a, b);
          const bGeC = satisfiesMinimum(b, c);
          const aGeC = satisfiesMinimum(a, c);

          // If A >= B and B >= C, then A >= C must hold
          if (aGeB && bGeC) {
            expect(aGeC).toBe(true);
          }
          // Property holds vacuously when premise is false
          return true;
        }),
        { numRuns: 100 },
      );
    });

    it("satisfiesMinimum is reflexive: any version >= itself", () => {
      fc.assert(
        fc.property(semverArb, (ver) => {
          expect(satisfiesMinimum(ver, ver)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("satisfiesMinimum is antisymmetric: if A >= B and B >= A then A == B", () => {
      fc.assert(
        fc.property(semverArb, semverArb, (a, b) => {
          if (satisfiesMinimum(a, b) && satisfiesMinimum(b, a)) {
            expect(a).toEqual(b);
          }
          return true;
        }),
        { numRuns: 100 },
      );
    });
  });
});
