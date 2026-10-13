// Feature: dependency-refresh-node24
// Task 7.3 — Unit tests for the GitHub Action major-currency check
//
// **Validates: Requirements 7.1, 7.2**
//
// These focused example-based tests exercise the pure action-currency core
// (`action-currency-core.ts`) — the parsing / pairing / currency decision that
// the `check-action-currency.ts` CLI wraps with filesystem I/O. They complement
// the Property 9 `fast-check` test (task 7.4) with concrete cases drawn from the
// two real workflows: current pins pass, superseded majors and non-immutable
// tags are flagged, and every flag names the file + reference (Req 7.1 / 7.2).
//
// The core is imported without a `.ts` extension so ts-jest (CommonJS) resolves
// it, matching the sibling `check-node-24.property.test.ts` / `crate-currency`
// import style. The filesystem wrapper is not imported here; the pure parser
// (`extractUses`) is driven over inline workflow snippets instead.

import {
  type ActionRef,
  checkActionCurrency,
  classifyPinnedRef,
  expectedFor,
  extractUses,
  pairWithExpected,
} from "./action-currency-core";

const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/installer-release.yml";

describe("classifyPinnedRef (Feature: dependency-refresh-node24, Req 7.1, 7.2)", () => {
  it("classifies a bare major tag as an immutable major tag", () => {
    expect(classifyPinnedRef("v5")).toBe("immutable-major-tag");
    expect(classifyPinnedRef("v12")).toBe("immutable-major-tag");
  });

  it("classifies a full-version tag distinctly from the bare major tag", () => {
    expect(classifyPinnedRef("v5.1")).toBe("full-version-tag");
    expect(classifyPinnedRef("v5.1.2")).toBe("full-version-tag");
  });

  it("classifies a 40-hex commit SHA as sha, a known branch as branch, and a channel as channel-tag", () => {
    expect(classifyPinnedRef("a".repeat(40))).toBe("sha");
    expect(classifyPinnedRef("main")).toBe("branch");
    expect(classifyPinnedRef("master")).toBe("branch");
    expect(classifyPinnedRef("stable")).toBe("channel-tag");
  });
});

describe("expectedFor (Feature: dependency-refresh-node24, Req 7.1, 7.2)", () => {
  it("resolves checkout / setup-node per workflow file (different current majors)", () => {
    expect(expectedFor(CI, "actions/checkout")).toBe("v5");
    expect(expectedFor(CI, "actions/setup-node")).toBe("v5");
    expect(expectedFor(RELEASE, "actions/checkout")).toBe("v7");
    expect(expectedFor(RELEASE, "actions/setup-node")).toBe("v6");
  });

  it("resolves the globally-gated actions and the rust-toolchain channel", () => {
    expect(expectedFor(CI, "codecov/codecov-action")).toBe("v5");
    expect(expectedFor(CI, "dorny/paths-filter")).toBe("v3");
    expect(expectedFor(RELEASE, "swatinem/rust-cache")).toBe("v2");
    expect(expectedFor(RELEASE, "tauri-apps/tauri-action")).toBe("v0");
    expect(expectedFor(RELEASE, "actions/upload-artifact")).toBe("v7");
    expect(expectedFor(RELEASE, "actions/download-artifact")).toBe("v8");
    expect(expectedFor(RELEASE, "softprops/action-gh-release")).toBe("v3");
    expect(expectedFor(RELEASE, "dtolnay/rust-toolchain")).toBe("stable");
  });

  it("returns null for actions not gated by Phase G", () => {
    expect(expectedFor(CI, "some/unrelated-action")).toBeNull();
  });
});

describe("extractUses (Feature: dependency-refresh-node24, Req 7.1, 7.2)", () => {
  it("extracts list-item and plain `uses:` refs, splitting action@ref on the last @", () => {
    const yaml = [
      "    steps:",
      "      - uses: actions/checkout@v5",
      "      - name: Setup Node",
      "        uses: actions/setup-node@v6",
    ].join("\n");
    expect(extractUses(CI, yaml)).toEqual([
      { filePath: CI, action: "actions/checkout", pinned: "v5" },
      { filePath: CI, action: "actions/setup-node", pinned: "v6" },
    ]);
  });

  it("strips surrounding quotes and trailing inline comments from the ref", () => {
    const yaml = '      - uses: "actions/checkout@v7"  # pinned major\n';
    expect(extractUses(RELEASE, yaml)).toEqual([
      { filePath: RELEASE, action: "actions/checkout", pinned: "v7" },
    ]);
  });

  it("ignores composite/local and docker `uses:` without an @-ref", () => {
    const yaml = [
      "      - uses: ./.github/actions/local",
      "      - uses: docker://alpine",
      "      - uses: actions/checkout@v5",
    ].join("\n");
    expect(extractUses(CI, yaml)).toEqual([
      { filePath: CI, action: "actions/checkout", pinned: "v5" },
    ]);
  });
});

describe("pairWithExpected (Feature: dependency-refresh-node24, Req 7.1, 7.2)", () => {
  it("pairs gated refs with their expected major and drops ungated ones", () => {
    const uses = [
      { filePath: CI, action: "actions/checkout", pinned: "v5" },
      { filePath: CI, action: "some/unrelated-action", pinned: "v1" },
      { filePath: RELEASE, action: "actions/setup-node", pinned: "v6" },
    ];
    expect(pairWithExpected(uses)).toEqual([
      { filePath: CI, action: "actions/checkout", pinned: "v5", expected: "v5" },
      { filePath: RELEASE, action: "actions/setup-node", pinned: "v6", expected: "v6" },
    ]);
  });
});

describe("checkActionCurrency (Feature: dependency-refresh-node24, Req 7.1, 7.2)", () => {
  it("passes when every reference pins its expected current major via an immutable major tag", () => {
    const refs: ActionRef[] = [
      { filePath: CI, action: "actions/checkout", pinned: "v5", expected: "v5" },
      { filePath: CI, action: "codecov/codecov-action", pinned: "v5", expected: "v5" },
      { filePath: RELEASE, action: "actions/download-artifact", pinned: "v8", expected: "v8" },
      { filePath: RELEASE, action: "dtolnay/rust-toolchain", pinned: "stable", expected: "stable" },
    ];
    const report = checkActionCurrency(refs);
    expect(report.ok).toBe(true);
    expect(report.flagged).toEqual([]);
  });

  it("flags a superseded numbered major, naming the file + reference", () => {
    const refs: ActionRef[] = [
      { filePath: CI, action: "actions/checkout", pinned: "v3", expected: "v5" },
    ];
    const report = checkActionCurrency(refs);
    expect(report.ok).toBe(false);
    expect(report.flagged).toHaveLength(1);
    const flag = report.flagged[0];
    expect(flag.filePath).toBe(CI);
    expect(flag.action).toBe("actions/checkout");
    expect(flag.pinned).toBe("v3");
    expect(flag.pinnedKind).toBe("immutable-major-tag");
    // The reason names both the file and the reference (Req 7.1 / 7.2).
    expect(flag.reason).toContain(CI);
    expect(flag.reason).toContain("actions/checkout");
    expect(flag.reason).toContain("superseded");
  });

  it("flags non-immutable / non-major-tag pins (branch, full-version, SHA)", () => {
    const refs: ActionRef[] = [
      { filePath: CI, action: "actions/checkout", pinned: "main", expected: "v5" },
      { filePath: CI, action: "codecov/codecov-action", pinned: "v5.1.2", expected: "v5" },
      { filePath: RELEASE, action: "swatinem/rust-cache", pinned: "b".repeat(40), expected: "v2" },
    ];
    const report = checkActionCurrency(refs);
    expect(report.ok).toBe(false);
    expect(report.flagged.map((f) => f.pinnedKind)).toEqual(["branch", "full-version-tag", "sha"]);
    for (const f of report.flagged) {
      expect(f.reason).toContain(f.filePath);
      expect(f.reason).toContain(f.action);
    }
  });

  it("flags a channel expectation pinned to the wrong value", () => {
    const refs: ActionRef[] = [
      {
        filePath: RELEASE,
        action: "dtolnay/rust-toolchain",
        pinned: "nightly",
        expected: "stable",
      },
    ];
    const report = checkActionCurrency(refs);
    expect(report.ok).toBe(false);
    expect(report.flagged[0].reason).toContain("channel");
  });
});
