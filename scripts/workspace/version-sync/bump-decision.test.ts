// Feature: dependency-refresh-node24
// Task 9.3 — Unit tests for the version-bump decision with distinct rejection channels
//
// **Validates: Requirements 9.1, 9.2, 9.10**
//
// These focused example-based tests exercise the pure bump-decision core
// (`bump-decision-core.ts`) — the accept / invalid-version-value /
// unmet-prerequisite decision that the Phase I sync tool wraps with filesystem
// I/O. They complement the Property 5 `fast-check` test (task 9.4) with concrete
// cases: accept, invalid semver, not-greater (equal and lower), and
// valid-greater-but-unmet-prerequisite (enumerating each unmet prerequisite),
// plus the guarantee that the two rejection `kind`s are distinct and never
// conflated (Req 9.2 vs 9.10).
//
// The core is imported without a `.ts` extension so ts-jest (CommonJS) resolves
// it, matching the sibling `peer-resolution-core` / `crate-currency-core`
// import style. No filesystem wrapper is imported; `decideBump` is pure.

import {
  type BumpDecisionInput,
  compareSemVer,
  decideBump,
  isValidSemVer,
  PREREQUISITE_LABELS,
  type PrerequisiteState,
  parseSemVer,
} from "./bump-decision-core";

/** All prerequisites met — the only state under which an accept is possible. */
const ALL_MET: PrerequisiteState = {
  allGatesPassing: true,
  installerReleasePassing: true,
};

/** Convenience builder so each case reads as (current, proposed, prereqs). */
function decide(
  current: string,
  proposed: string,
  prerequisites: PrerequisiteState = ALL_MET,
): ReturnType<typeof decideBump> {
  const input: BumpDecisionInput = { current, proposed, prerequisites };
  return decideBump(input);
}

describe("parseSemVer / isValidSemVer (Feature: dependency-refresh-node24, Req 9.1, 9.2)", () => {
  it("parses a normal MAJOR.MINOR.PATCH release", () => {
    expect(parseSemVer("5.3.0")).toEqual({ major: 5, minor: 3, patch: 0, prerelease: [] });
    expect(isValidSemVer("5.3.0")).toBe(true);
  });

  it("parses a prerelease and retains its identifiers", () => {
    expect(parseSemVer("5.3.0-rc.1")).toEqual({
      major: 5,
      minor: 3,
      patch: 0,
      prerelease: ["rc", "1"],
    });
  });

  it("ignores build metadata for parsing (dropped, not retained)", () => {
    expect(parseSemVer("5.3.0+build.7")).toEqual({ major: 5, minor: 3, patch: 0, prerelease: [] });
  });

  it("rejects non-semver values (offending inputs)", () => {
    for (const bad of ["", "5", "5.3", "v5.3.0", "5.3.0.0", "5.03.0", "abc", "latest", "^5.3.0"]) {
      expect(parseSemVer(bad)).toBeNull();
      expect(isValidSemVer(bad)).toBe(false);
    }
  });
});

describe("compareSemVer precedence (Feature: dependency-refresh-node24, Req 9.1)", () => {
  const p = (v: string) => {
    const parsed = parseSemVer(v);
    if (parsed === null) throw new Error(`test setup: ${v} is not semver`);
    return parsed;
  };

  it("orders by MAJOR, then MINOR, then PATCH", () => {
    expect(compareSemVer(p("6.0.0"), p("5.9.9"))).toBeGreaterThan(0);
    expect(compareSemVer(p("5.4.0"), p("5.3.9"))).toBeGreaterThan(0);
    expect(compareSemVer(p("5.3.1"), p("5.3.0"))).toBeGreaterThan(0);
    expect(compareSemVer(p("5.3.0"), p("5.3.0"))).toBe(0);
    expect(compareSemVer(p("5.2.9"), p("5.3.0"))).toBeLessThan(0);
  });

  it("ranks a prerelease below the corresponding release", () => {
    expect(compareSemVer(p("5.3.0-rc.1"), p("5.3.0"))).toBeLessThan(0);
    expect(compareSemVer(p("5.3.0"), p("5.3.0-rc.1"))).toBeGreaterThan(0);
    expect(compareSemVer(p("5.3.0-rc.2"), p("5.3.0-rc.1"))).toBeGreaterThan(0);
  });
});

describe("decideBump — ACCEPT (Feature: dependency-refresh-node24, Req 9.1)", () => {
  it("accepts a valid, strictly-greater version when all prerequisites are met", () => {
    const result = decide("5.3.0", "5.4.0", ALL_MET);
    expect(result).toEqual({ kind: "accept", target: "5.4.0" });
  });

  it("accepts a patch/minor/major bump alike when prerequisites are met", () => {
    expect(decide("5.3.0", "5.3.1").kind).toBe("accept");
    expect(decide("5.3.0", "5.4.0").kind).toBe("accept");
    expect(decide("5.3.0", "6.0.0").kind).toBe("accept");
  });
});

describe("decideBump — invalid-version-value: invalid semver (Feature: dependency-refresh-node24, Req 9.2)", () => {
  it("rejects a non-semver proposed value naming the offending value, retaining current", () => {
    const result = decide("5.3.0", "not-a-version", ALL_MET);
    expect(result.kind).toBe("invalid-version-value");
    if (result.kind !== "invalid-version-value") throw new Error("expected invalid-version-value");
    // The offending value is named verbatim.
    expect(result.proposed).toBe("not-a-version");
    expect(result.reason).toContain("not-a-version");
    // The current version is named as retained.
    expect(result.reason).toContain("5.3.0");
  });

  it("treats a range/prefix/partial as an invalid value (not a bare semver)", () => {
    for (const bad of ["^5.4.0", "v5.4.0", "5.4", "5"]) {
      expect(decide("5.3.0", bad).kind).toBe("invalid-version-value");
    }
  });

  it("does not consult prerequisites for an invalid value (still invalid even with all met)", () => {
    expect(decide("5.3.0", "garbage", ALL_MET).kind).toBe("invalid-version-value");
  });
});

describe("decideBump — invalid-version-value: not strictly greater (Feature: dependency-refresh-node24, Req 9.2)", () => {
  it("rejects an equal version as not strictly greater, retaining current", () => {
    const result = decide("5.3.0", "5.3.0", ALL_MET);
    expect(result.kind).toBe("invalid-version-value");
    if (result.kind !== "invalid-version-value") throw new Error("expected invalid-version-value");
    expect(result.proposed).toBe("5.3.0");
    expect(result.reason).toContain("strictly greater");
  });

  it("rejects a lower version as not strictly greater", () => {
    expect(decide("5.3.0", "5.2.9").kind).toBe("invalid-version-value");
    expect(decide("5.3.0", "4.0.0").kind).toBe("invalid-version-value");
    expect(decide("5.3.0", "5.3.0-rc.1").kind).toBe("invalid-version-value");
  });

  it("classifies not-greater as invalid-value even when prerequisites are unmet (value channel wins)", () => {
    const unmetPrereqs: PrerequisiteState = {
      allGatesPassing: false,
      installerReleasePassing: false,
    };
    // Equal version + unmet prereqs -> still invalid-version-value, NOT unmet-prerequisite.
    expect(decide("5.3.0", "5.3.0", unmetPrereqs).kind).toBe("invalid-version-value");
  });
});

describe("decideBump — unmet-prerequisite (Feature: dependency-refresh-node24, Req 9.10)", () => {
  it("rejects a valid, greater version when gates are not passing, enumerating that prerequisite", () => {
    const result = decide("5.3.0", "5.4.0", {
      allGatesPassing: false,
      installerReleasePassing: true,
    });
    expect(result.kind).toBe("unmet-prerequisite");
    if (result.kind !== "unmet-prerequisite") throw new Error("expected unmet-prerequisite");
    expect(result.proposed).toBe("5.4.0");
    expect(result.unmet).toEqual([PREREQUISITE_LABELS.allGatesPassing]);
  });

  it("rejects when the installer release is not passing, enumerating that prerequisite", () => {
    const result = decide("5.3.0", "5.4.0", {
      allGatesPassing: true,
      installerReleasePassing: false,
    });
    expect(result.kind).toBe("unmet-prerequisite");
    if (result.kind !== "unmet-prerequisite") throw new Error("expected unmet-prerequisite");
    expect(result.unmet).toEqual([PREREQUISITE_LABELS.installerReleasePassing]);
  });

  it("enumerates EACH unmet prerequisite when several are unmet", () => {
    const result = decide("5.3.0", "5.4.0", {
      allGatesPassing: false,
      installerReleasePassing: false,
    });
    expect(result.kind).toBe("unmet-prerequisite");
    if (result.kind !== "unmet-prerequisite") throw new Error("expected unmet-prerequisite");
    expect(result.unmet).toEqual([
      PREREQUISITE_LABELS.allGatesPassing,
      PREREQUISITE_LABELS.installerReleasePassing,
    ]);
    expect(result.unmet).toHaveLength(2);
  });
});

describe("decideBump — the two rejection kinds are DISTINCT (Feature: dependency-refresh-node24, Req 9.2 vs 9.10)", () => {
  it("uses distinct kind literals that are never conflated", () => {
    const invalid = decide("5.3.0", "bad", ALL_MET);
    const unmet = decide("5.3.0", "5.4.0", {
      allGatesPassing: false,
      installerReleasePassing: false,
    });

    expect(invalid.kind).toBe("invalid-version-value");
    expect(unmet.kind).toBe("unmet-prerequisite");
    // The two indications are textually distinct kinds.
    expect(invalid.kind).not.toBe(unmet.kind);
  });

  it("a valid-and-greater value blocked only by a prerequisite is NEVER reported as invalid-value", () => {
    const result = decide("5.3.0", "5.4.0", {
      allGatesPassing: false,
      installerReleasePassing: true,
    });
    expect(result.kind).not.toBe("invalid-version-value");
    expect(result.kind).toBe("unmet-prerequisite");
  });

  it("an invalid/not-greater value is NEVER reported as unmet-prerequisite, regardless of prereq state", () => {
    // Invalid value + unmet prereqs.
    expect(
      decide("5.3.0", "nope", { allGatesPassing: false, installerReleasePassing: false }).kind,
    ).toBe("invalid-version-value");
    // Not-greater value + unmet prereqs.
    expect(
      decide("5.3.0", "5.2.0", { allGatesPassing: false, installerReleasePassing: false }).kind,
    ).toBe("invalid-version-value");
  });
});
