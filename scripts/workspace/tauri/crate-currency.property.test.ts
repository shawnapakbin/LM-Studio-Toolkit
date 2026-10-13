// Feature: dependency-refresh-node24, Property 8: Tauri crate major matches the CLI major

/**
 * Feature: dependency-refresh-node24
 * Property 8: Tauri crate major matches the CLI major
 *
 * For all `(cliVersion, crateVersion)` pairs, `checkCrateMatchesCli` SHALL report
 * `ok: true` IF AND ONLY IF both raw versions resolve to a numeric major AND
 * those majors are equal; otherwise the pair is FLAGGED (`ok: false`) carrying
 * both raw versions and their resolved majors (`null` when unparseable). An
 * unparseable version can never equal another value's major, so it always flags.
 *
 * Validates: Requirements 5.2
 * Design: Property 8
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `checkCrateMatchesCli` is the pure crate/CLI major-currency core consumed by
 * the file-scanning CLI (`check-crate-currency.ts`). This test drives the REAL
 * function (imported from `crate-currency-core.ts`, no mocks) over generated
 * `(cliVersion, crateVersion)` pairs that mix the version forms found in
 * `package.json` ranges and `Cargo.toml` requirements: bare majors, partial /
 * full versions, caret / tilde ranges, `v`-prefixed versions, comparator ranges,
 * and unparseable values (`""`, `"latest"`).
 *
 * Each raw version is drawn from a pool tagged with the leading numeric major it
 * resolves to (or `null` when unparseable). That tag is an INDEPENDENT oracle —
 * hand-decided from the acceptance criteria, NOT by re-calling the module's own
 * `parseMajor`. We then assert the function agrees exactly: `cliMajor` /
 * `crateMajor` equal the tagged oracle majors, `ok` is the biconditional of
 * "both majors non-null AND equal", a flagged pair carries both raw versions and
 * their resolved majors, and any unparseable side forces `ok: false`.
 */

import * as fc from "fast-check";
import { checkCrateMatchesCli } from "./crate-currency-core";

/**
 * A pool of raw version forms tagged with the major they resolve to, decided
 * independently from the acceptance criteria (the leading numeric major, or
 * `null` when no numeric major can be extracted). This deliberately does NOT
 * reuse `parseMajor`, so the oracle shares no parsing logic with the code
 * under test.
 */
interface TaggedVersion {
  raw: string;
  major: number | null;
}

const VERSION_POOL: readonly TaggedVersion[] = [
  // bare majors
  { raw: "2", major: 2 },
  { raw: "3", major: 3 },
  // partial / full versions
  { raw: "2.1", major: 2 },
  { raw: "2.1.3", major: 2 },
  { raw: "3.0.0", major: 3 },
  // caret / tilde ranges
  { raw: "^2.8.0", major: 2 },
  { raw: "~2.1", major: 2 },
  { raw: "^3.0.0", major: 3 },
  // v-prefixed
  { raw: "v2.1.0", major: 2 },
  { raw: "v3.2.1", major: 3 },
  // comparator ranges (leading lower-bound major)
  { raw: ">=2.0.0 <3", major: 2 },
  { raw: ">2.0.0", major: 2 },
  { raw: ">=3.0.0 <4", major: 3 },
  // unparseable — no leading numeric major
  { raw: "latest", major: null },
  { raw: "", major: null },
  { raw: "*", major: null },
] as const;

const versionArb: fc.Arbitrary<TaggedVersion> = fc.constantFrom(...VERSION_POOL);

describe("Feature: dependency-refresh-node24, Property 8: Tauri crate major matches the CLI major", () => {
  it("ok iff both versions resolve to a numeric major AND those majors are equal; flagged pairs carry both raw versions + resolved majors", () => {
    fc.assert(
      fc.property(versionArb, versionArb, (cli, crate) => {
        const result = checkCrateMatchesCli(cli.raw, crate.raw);

        // Independent oracle: pass iff both parse to a major and majors match.
        const expectedOk = cli.major !== null && crate.major !== null && cli.major === crate.major;

        // Resolved majors match the independently-tagged oracle majors.
        expect(result.cliMajor).toBe(cli.major);
        expect(result.crateMajor).toBe(crate.major);

        // The biconditional at the heart of Property 8 / Req 5.2.
        expect(result.ok).toBe(expectedOk);

        // The result always echoes the raw versions unchanged, so a flagged
        // pair carries both raw versions and their resolved majors for reporting.
        expect(result.cliVersion).toBe(cli.raw);
        expect(result.crateVersion).toBe(crate.raw);

        // When flagged, the report surfaces enough to see which side is off:
        // both raw versions and both resolved majors are present.
        if (!result.ok) {
          const majorsMissingOrDiffer =
            result.cliMajor === null ||
            result.crateMajor === null ||
            result.cliMajor !== result.crateMajor;
          expect(majorsMissingOrDiffer).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("equal resolved majors always pass, regardless of the version form used on each side", () => {
    // Draw two versions that share the same resolved major (both parseable).
    const sameMajorPairArb: fc.Arbitrary<[TaggedVersion, TaggedVersion]> = fc
      .constantFrom(...new Set(VERSION_POOL.filter((v) => v.major !== null).map((v) => v.major)))
      .chain((major) => {
        const withMajor = VERSION_POOL.filter((v) => v.major === major);
        return fc.tuple(fc.constantFrom(...withMajor), fc.constantFrom(...withMajor));
      });

    fc.assert(
      fc.property(sameMajorPairArb, ([cli, crate]) => {
        const result = checkCrateMatchesCli(cli.raw, crate.raw);
        expect(result.ok).toBe(true);
        expect(result.cliMajor).toBe(cli.major);
        expect(result.crateMajor).toBe(crate.major);
        expect(result.cliMajor).toBe(result.crateMajor);
      }),
      { numRuns: 100 },
    );
  });

  it("an unparseable version on either side always flags the pair (ok=false)", () => {
    const unparseableArb: fc.Arbitrary<TaggedVersion> = fc.constantFrom(
      ...VERSION_POOL.filter((v) => v.major === null),
    );

    fc.assert(
      fc.property(unparseableArb, versionArb, (bad, other) => {
        // bad on the CLI side.
        const a = checkCrateMatchesCli(bad.raw, other.raw);
        expect(a.ok).toBe(false);
        expect(a.cliMajor).toBeNull();

        // bad on the crate side.
        const b = checkCrateMatchesCli(other.raw, bad.raw);
        expect(b.ok).toBe(false);
        expect(b.crateMajor).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
