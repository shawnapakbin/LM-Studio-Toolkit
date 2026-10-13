/**
 * Pure GitHub-Action major-currency core for the dependency-refresh (Phase G).
 *
 * Feature: dependency-refresh-node24 (Requirements 7.1, 7.2)
 *
 * This module contains ONLY pure, I/O-free functions. It turns a set of already
 * extracted GitHub Action references (each: the workflow file it lives in, the
 * action name, the pinned ref, and the EXPECTED current major for that action)
 * into an `ActionCurrencyReport`, deciding for each reference whether it pins
 * the action at its expected current major via an IMMUTABLE MAJOR TAG.
 *
 * The file-scanning / process-exit wrapper (reading every `uses: <action>@<ref>`
 * line out of both workflow files and pairing it with an expected-major table)
 * lives in `check-action-currency.ts`, mirroring the
 * `check-node-24-core.ts` / `check-node-24.ts`,
 * `crate-currency-core.ts` / `check-crate-currency.ts`, and
 * `shared-consistency-core.ts` / `check-shared-consistency.ts` splits already
 * used in `scripts/workspace/`.
 *
 * Keeping the core pure means:
 *   - the scanning CLI (`check-action-currency.ts`) reuses the exact currency
 *     decision, and
 *   - the Property 9 `fast-check` test (task 7.4) can import
 *     `checkActionCurrency` and property-test it over generated action-reference
 *     sets without touching the filesystem.
 *
 * Currency contract (design.md "Property 9", Req 7.1 / 7.2):
 *   A reference PASSES if and only if it pins the action at its expected current
 *   major via an immutable major tag. Two immutable-major-tag shapes exist:
 *     - a NUMBERED major tag `v<N>` (e.g. `@v5`) that equals the expected
 *       numbered major (`v5`); and
 *     - a CHANNEL tag (e.g. `stable`) for actions whose "major" is a named
 *       channel rather than a number (e.g. `dtolnay/rust-toolchain@stable`) —
 *       compliant when the expected ref is that same channel and the pinned ref
 *       matches it.
 *   A reference is FLAGGED when it pins:
 *     - a SUPERSEDED numbered major (e.g. `@v3` when `v5` is expected),
 *     - a NON-IMMUTABLE / floating ref (a branch like `@main` / `@master`, or a
 *       full-version tag like `@v5.1.2` that is not the bare major tag), or
 *     - a full commit SHA — which is immutable but is NOT a "major tag", so it
 *       does not satisfy the "immutable major tag" contract this check enforces.
 *   Every flagged reference names its file and the reference (action + pinned
 *   ref) so the caller can locate it. `ok` is true iff no reference is flagged.
 */

/**
 * The expected current major for each action the refresh is responsible for
 * (tasks 7.1 / 7.2). Values are the expected immutable major tag (`v<N>`) or a
 * named channel (`stable`). This is the allow-list the Phase G gate enforces —
 * actions absent from it are surfaced in the report but not flagged, since
 * Phase G asserts no expectation for them.
 *
 * NOTE: `actions/checkout` and `actions/setup-node` appear in BOTH workflows but
 * at different current majors (ci.yml pins v5/v5; installer-release.yml pins
 * v7/v6), so their expected major is resolved per file via `PER_FILE_EXPECTED`
 * below rather than from this flat map.
 */
export const EXPECTED_ACTION_MAJORS: Readonly<Record<string, string>> = {
  // ci.yml (task 7.1)
  "codecov/codecov-action": "v5",
  "dorny/paths-filter": "v3",
  // installer-release.yml (task 7.2)
  "dtolnay/rust-toolchain": "stable",
  "swatinem/rust-cache": "v2",
  "tauri-apps/tauri-action": "v0",
  "actions/upload-artifact": "v7",
  "actions/download-artifact": "v8",
  "softprops/action-gh-release": "v3",
};

/**
 * Per-file expected-major overrides. `actions/checkout` and `actions/setup-node`
 * are pinned to different current majors in the two workflows, so their expected
 * major depends on the file. Everything else uses `EXPECTED_ACTION_MAJORS`.
 */
export const PER_FILE_EXPECTED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ".github/workflows/ci.yml": {
    "actions/checkout": "v5",
    "actions/setup-node": "v5",
  },
  ".github/workflows/installer-release.yml": {
    "actions/checkout": "v7",
    "actions/setup-node": "v6",
  },
};

/**
 * Resolve the expected current major for `action` in `filePath`, honouring the
 * per-file overrides first (checkout / setup-node differ per workflow), then the
 * global table (Req 7.1 / 7.2). Returns `null` when the action is not gated by
 * Phase G. Pure and I/O-free.
 */
export function expectedFor(filePath: string, action: string): string | null {
  const perFile = PER_FILE_EXPECTED[filePath];
  if (perFile && Object.hasOwn(perFile, action)) return perFile[action];
  if (Object.hasOwn(EXPECTED_ACTION_MAJORS, action)) return EXPECTED_ACTION_MAJORS[action];
  return null;
}

/**
 * A raw `uses:` reference extracted from a workflow file, before pairing with an
 * expected major.
 */
export interface UsesRef {
  filePath: string;
  action: string;
  pinned: string;
}

/**
 * Extract every `uses: <action>@<ref>` reference from a workflow file's text
 * (pure — the caller supplies the already-read content).
 *
 * A step reference is a single line of the form `<indent>[- ]uses: <value>`
 * where `<value>` is `<action>@<ref>` (optionally quoted, optionally trailed by
 * a `#` comment). Composite/local `uses:` without an `@` (e.g. `./.github/...`
 * or `docker://...`) are ignored — they are not versioned action refs. No YAML
 * dependency is used; the `uses:` line is self-contained and matched directly.
 */
export function extractUses(filePath: string, content: string): UsesRef[] {
  const refs: UsesRef[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    // `uses:` may be a list-item (`- uses:`) or a plain key (`uses:`).
    const m = /^\s*(?:-\s+)?uses:\s*(\S.*)$/.exec(rawLine);
    if (!m) continue;

    // Strip trailing inline comment, then surrounding quotes.
    let value = m[1].split("#")[0].trim();
    value = value.replace(/^['"]/, "").replace(/['"]$/, "").trim();
    if (value.length === 0) continue;

    // A versioned action ref is `<action>@<ref>`. Split on the LAST `@` so
    // scoped/owner names are handled; refs without `@` (local/docker uses) are
    // skipped, as are refs with an empty action or empty pinned side.
    const at = value.lastIndexOf("@");
    if (at <= 0 || at === value.length - 1) continue;
    const action = value.slice(0, at);
    const pinned = value.slice(at + 1);

    refs.push({ filePath, action, pinned });
  }
  return refs;
}

/**
 * Pair a set of extracted `uses:` references with their expected current major,
 * dropping any action not gated by Phase G (pure — the file-scanning wrapper
 * supplies the `UsesRef[]`).
 *
 * This is the pure bridge between the raw workflow scan and `checkActionCurrency`:
 * it applies the per-file / global expected-major resolution and produces the
 * `ActionRef[]` the currency decision consumes.
 */
export function pairWithExpected(usesRefs: ReadonlyArray<UsesRef>): ActionRef[] {
  const refs: ActionRef[] = [];
  for (const uses of usesRefs) {
    const expected = expectedFor(uses.filePath, uses.action);
    if (expected === null) continue; // not gated by Phase G
    refs.push({
      filePath: uses.filePath,
      action: uses.action,
      pinned: uses.pinned,
      expected,
    });
  }
  return refs;
}

/**
 * A single GitHub Action reference extracted from a workflow file, paired with
 * the expected current major for that action.
 *
 * `pinned` is the ref exactly as it appears after the `@` in a
 * `uses: <action>@<ref>` line (e.g. `"v5"`, `"v3"`, `"stable"`, `"main"`, a full
 * SHA, or `"v5.1.2"`). `expected` is the expected current major for `action`:
 * either a numbered major tag (`"v5"`) or a named channel (`"stable"`).
 */
export interface ActionRef {
  /** The workflow file the reference lives in (e.g. `".github/workflows/ci.yml"`). */
  filePath: string;
  /** The action name (e.g. `"actions/checkout"`). */
  action: string;
  /** The pinned ref exactly as written after `@` (e.g. `"v5"`, `"stable"`, `"main"`). */
  pinned: string;
  /** The expected current major for this action: `"v<N>"` or a channel like `"stable"`. */
  expected: string;
}

/**
 * How a pinned ref is classified. Only `immutable-major-tag` (a bare `v<N>`) and
 * `channel-tag` (a named channel like `stable`) can ever be compliant; the other
 * kinds are inherently non-immutable-major or not-a-major-tag and always flag.
 */
export type PinnedRefKind =
  | "immutable-major-tag" // bare `v<N>` (e.g. `v5`)
  | "channel-tag" // named channel (e.g. `stable`, `beta`)
  | "full-version-tag" // `v<N>.<M>` / `v<N>.<M>.<P>` — not the bare major tag
  | "branch" // floating branch ref (e.g. `main`, `master`)
  | "sha" // full 40-hex commit SHA — immutable but not a major tag
  | "unknown"; // anything else / empty

/**
 * A single flagged reference as surfaced to the caller (Req 7.1 / 7.2). It names
 * the file and the reference (action + pinned ref), the expected major, and a
 * human-readable reason so the caller can see exactly why the pin is off.
 */
export interface FlaggedAction {
  filePath: string;
  action: string;
  /** The pinned ref that was flagged. */
  pinned: string;
  /** The expected current major (numbered `v<N>` or channel). */
  expected: string;
  /** How the pinned ref was classified. */
  pinnedKind: PinnedRefKind;
  /** Human-readable explanation naming file + reference for reporting. */
  reason: string;
}

/**
 * The currency report, mirroring the shape of the other pure-core reports
 * (`NodeComplianceReport`, `CrateMatchResult`, `SharedConsistencyReport`).
 *
 * `refs` is the full set of evaluated references, `flagged` is exactly the
 * non-compliant subset (each carrying file + action + pinned + expected), and
 * `ok` is `flagged.length === 0`.
 */
export interface ActionCurrencyReport {
  refs: ActionRef[];
  flagged: FlaggedAction[];
  ok: boolean;
}

/**
 * A bare, immutable NUMBERED major tag: `v` followed by digits only (`v5`,
 * `v12`). A `v5.1` / `v5.1.2` is a full-version tag, NOT a bare major tag, so it
 * is deliberately excluded here.
 */
const BARE_MAJOR_TAG = /^v(\d+)$/;

/** A full-version tag: `v<N>.<...>` (e.g. `v5.1`, `v5.1.2`). */
const FULL_VERSION_TAG = /^v\d+\.\d+/;

/** A full 40-character hex commit SHA. */
const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * A channel-style tag: a lowercase alphabetic name such as `stable`, `beta`,
 * `nightly`. Used to classify non-`v` refs that are named channels rather than
 * branches. (Branch classification below is by convention over the common branch
 * names; any remaining alphabetic token is treated as a channel.)
 */
const COMMON_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk", "latest"]);

/**
 * Classify a pinned ref into a `PinnedRefKind` (pure, no expected-major input).
 *
 * The order matters: a bare `v<N>` is an immutable major tag; a `v<N>.<...>` is
 * a full-version tag; a 40-hex string is a SHA; a well-known branch name is a
 * branch; any other purely-alphabetic token is treated as a channel tag (so
 * `stable` classifies as `channel-tag`); everything else is `unknown`.
 */
export function classifyPinnedRef(pinned: string): PinnedRefKind {
  const ref = pinned.trim();
  if (ref.length === 0) return "unknown";
  if (BARE_MAJOR_TAG.test(ref)) return "immutable-major-tag";
  if (FULL_VERSION_TAG.test(ref)) return "full-version-tag";
  if (FULL_SHA.test(ref)) return "sha";
  if (COMMON_BRANCHES.has(ref.toLowerCase())) return "branch";
  // A purely-alphabetic token that is not a known branch is treated as a named
  // release channel (e.g. `stable`, `beta`, `nightly`).
  if (/^[a-z][a-z-]*$/i.test(ref)) return "channel-tag";
  return "unknown";
}

/**
 * Decide whether a single `ActionRef` is compliant, and if not, produce the
 * `FlaggedAction` explaining why (pure).
 *
 * Compliant iff the pinned ref is an IMMUTABLE MAJOR TAG matching the expected
 * major:
 *   - expected is a numbered major `v<N>` and `pinned` is the bare `v<N>`; or
 *   - expected is a channel (e.g. `stable`) and `pinned` is that same channel.
 * Returns `null` when compliant, or a `FlaggedAction` naming the file +
 * reference otherwise.
 */
export function evaluateActionRef(ref: ActionRef): FlaggedAction | null {
  const pinnedKind = classifyPinnedRef(ref.pinned);
  const expected = ref.expected.trim();
  const pinned = ref.pinned.trim();

  const flag = (reason: string): FlaggedAction => ({
    filePath: ref.filePath,
    action: ref.action,
    pinned: ref.pinned,
    expected: ref.expected,
    pinnedKind,
    reason,
  });

  const expectedIsNumberedMajor = BARE_MAJOR_TAG.test(expected);

  if (expectedIsNumberedMajor) {
    // Expected is a numbered major tag like `v5`. Only a bare `v<N>` matching it
    // exactly is compliant.
    if (pinnedKind === "immutable-major-tag") {
      if (pinned === expected) return null;
      return flag(
        `${ref.action} in ${ref.filePath} pins superseded major @${pinned}; ` +
          `expected current major @${expected} (immutable major tag).`,
      );
    }
    // Any non-bare-major pin against a numbered-major expectation is flagged with
    // a reason specific to why the pin is not an immutable major tag.
    return flag(nonMajorTagReason(ref, pinnedKind));
  }

  // Expected is a named channel (e.g. `stable`). Compliant iff pinned is that
  // same channel tag (case-insensitive), matching the immutable-channel form the
  // action publishes (e.g. `dtolnay/rust-toolchain@stable`).
  if (pinnedKind === "channel-tag" && pinned.toLowerCase() === expected.toLowerCase()) {
    return null;
  }
  return flag(
    `${ref.action} in ${ref.filePath} pins @${pinned}; ` +
      `expected current channel @${expected} (immutable channel tag).`,
  );
}

/**
 * Build the human-readable reason for a pin that is not a bare major tag when a
 * numbered major is expected.
 */
function nonMajorTagReason(ref: ActionRef, pinnedKind: PinnedRefKind): string {
  const head = `${ref.action} in ${ref.filePath} pins @${ref.pinned}`;
  const tail = `expected current major @${ref.expected} (immutable major tag).`;
  switch (pinnedKind) {
    case "full-version-tag":
      return `${head}, a full-version tag rather than the bare major tag; ${tail}`;
    case "branch":
      return `${head}, a floating branch ref (non-immutable); ${tail}`;
    case "sha":
      return `${head}, a full commit SHA (immutable, but not a major tag); ${tail}`;
    case "channel-tag":
      return `${head}, a channel tag rather than the numbered major tag; ${tail}`;
    default:
      return `${head}, which is not an immutable major tag; ${tail}`;
  }
}

/**
 * Build the `ActionCurrencyReport` from a set of GitHub Action references
 * (Req 7.1 / 7.2, Property 9).
 *
 * Pure and I/O-free. Each reference is evaluated with `evaluateActionRef`;
 * `flagged` contains exactly the references that do not pin the expected current
 * major via an immutable major tag, each naming its file + reference, and `ok`
 * is true iff `flagged` is empty.
 *
 * This is the pure function the Property 9 test drives directly.
 */
export function checkActionCurrency(refs: ReadonlyArray<ActionRef>): ActionCurrencyReport {
  const evaluated = refs.map((r) => ({ ...r }));
  const flagged: FlaggedAction[] = [];
  for (const ref of evaluated) {
    const result = evaluateActionRef(ref);
    if (result !== null) flagged.push(result);
  }
  return {
    refs: evaluated,
    flagged,
    ok: flagged.length === 0,
  };
}
