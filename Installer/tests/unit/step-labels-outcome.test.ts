/**
 * Wizard step-label ordering and outcome-screen tests.
 *
 * Feature: windows-installer-setup-exe (Requirements 9.1, 9.2, 9.3)
 *
 * The installer's jest setup runs in a Node environment and compiles only
 * `.ts` (no jsdom / @testing-library/react, and the transform does not handle
 * `.tsx`). So these tests exercise the frontend contract at the two levels that
 * are reachable without a DOM:
 *
 *   1. The pure step-order / label data (`STEP_ORDER`, `STEP_LABELS`) and the
 *      extracted step-status logic (`src/phases/stepStatus.ts`) that
 *      `InstallingPhase` renders from. This is where the Req 9.1 ordering and
 *      the Req 9.3 fail-fast display behaviour actually live.
 *   2. The `InstallingPhase.tsx` / `CompletePhase.tsx` source, asserting the
 *      JSX renders those labels in order and shows the success screen (Req 9.2)
 *      — a source-contract check in the same spirit as the repo's existing
 *      manifest tests, since the components can't be mounted here.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getStatusIcon, getStepStatus } from "../../src/phases/stepStatus";
import { type InstallStep, STEP_LABELS, STEP_ORDER } from "../../src/types";

/** Installer/ root, resolved from this test file's location. */
const installerRoot = resolve(__dirname, "..", "..");
const INSTALLING_PHASE_PATH = resolve(installerRoot, "src", "phases", "InstallingPhase.tsx");
const COMPLETE_PHASE_PATH = resolve(installerRoot, "src", "phases", "CompletePhase.tsx");

/** The five provisioning steps in the exact Req 9.1 order. */
const REQ_9_1_ORDER: InstallStep[] = [
  "runtimes",
  "copy-tools",
  "lm-studio-plugin-dirs",
  "env-config",
  "uninstall-registration",
];

describe("step order + labels — Req 9.1", () => {
  it("STEP_ORDER lists the five provisioning steps in the Req 9.1 order", () => {
    expect(STEP_ORDER).toEqual(REQ_9_1_ORDER);
  });

  it("STEP_ORDER has exactly five distinct steps", () => {
    expect(STEP_ORDER).toHaveLength(5);
    expect(new Set(STEP_ORDER).size).toBe(5);
  });

  it("STEP_LABELS maps every step to a non-empty human label", () => {
    for (const step of STEP_ORDER) {
      const label = STEP_LABELS[step];
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("STEP_LABELS has a label for exactly the STEP_ORDER steps (no extras/missing)", () => {
    expect(Object.keys(STEP_LABELS).sort()).toEqual([...STEP_ORDER].sort());
  });

  it("InstallingPhase renders the step labels in STEP_ORDER order", () => {
    // The component maps over STEP_ORDER, so the rendered label sequence is the
    // order the labels appear in the STEP_LABELS lookup driven by STEP_ORDER.
    const renderedLabels = STEP_ORDER.map((step) => STEP_LABELS[step]);
    expect(renderedLabels).toEqual([
      "Runtimes",
      "Copy Tools",
      "LM Studio Plugin Dirs",
      "Env Config",
      "Uninstall Registration",
    ]);

    // And the component drives its rendering from STEP_ORDER (not a hand-rolled
    // list that could drift out of the Req 9.1 order).
    const src = readFileSync(INSTALLING_PHASE_PATH, "utf8");
    expect(src).toMatch(/STEP_ORDER\.map/);
    expect(src).toMatch(/STEP_LABELS\[/);
  });
});

describe("InstallingPhase step status — progress display (Req 9.1)", () => {
  it("marks the current step active, earlier steps completed, later steps pending", () => {
    const current: InstallStep = "lm-studio-plugin-dirs";
    const statuses = STEP_ORDER.map((step) => getStepStatus(step, current, false));
    expect(statuses).toEqual([
      "completed", // runtimes
      "completed", // copy-tools
      "active", //    lm-studio-plugin-dirs  <- current
      "pending", //   env-config
      "pending", //   uninstall-registration
    ]);
  });

  it("marks exactly one step active while no error is present", () => {
    for (const current of STEP_ORDER) {
      const active = STEP_ORDER.filter((step) => getStepStatus(step, current, false) === "active");
      expect(active).toEqual([current]);
    }
  });

  it("status icons distinguish completed / active / pending / failed glyphs", () => {
    const icons = new Set([
      getStatusIcon("completed"),
      getStatusIcon("active"),
      getStatusIcon("pending"),
      getStatusIcon("failed"),
    ]);
    // Four distinct glyphs.
    expect(icons.size).toBe(4);
  });
});

describe("InstallingPhase failure display — fail-fast (Req 9.3)", () => {
  it("marks the failed step failed and shows NO step after it as active/running", () => {
    // Fail on the third step; the current step reported by the backend at the
    // moment of failure is the failing step itself.
    const failedStep: InstallStep = "lm-studio-plugin-dirs";
    const statuses = STEP_ORDER.map((step) => getStepStatus(step, failedStep, true, failedStep));

    expect(statuses).toEqual([
      "completed", // runtimes
      "completed", // copy-tools
      "failed", //    lm-studio-plugin-dirs  <- failed here
      "pending", //   env-config              (must NOT run)
      "pending", //   uninstall-registration  (must NOT run)
    ]);

    // No step is ever shown as "active"/running once an error exists (Req 9.3).
    expect(statuses).not.toContain("active");
  });

  it("for EVERY possible failing step, no later step is active and none is completed past the failure", () => {
    // Property-style sweep over all five failure positions (Req 9.3).
    STEP_ORDER.forEach((failedStep, failedIdx) => {
      STEP_ORDER.forEach((step, idx) => {
        const status = getStepStatus(step, failedStep, true, failedStep);
        if (idx < failedIdx) {
          expect(status).toBe("completed");
        } else if (idx === failedIdx) {
          expect(status).toBe("failed");
        } else {
          // Steps after the failure must be pending — never active or completed.
          expect(status).toBe("pending");
        }
        // Under an error, nothing is ever "active" (would look like it's still
        // running).
        expect(status).not.toBe("active");
      });
    });
  });

  it("exactly one step is marked failed on any failure", () => {
    STEP_ORDER.forEach((failedStep) => {
      const failed = STEP_ORDER.filter(
        (step) => getStepStatus(step, failedStep, true, failedStep) === "failed",
      );
      expect(failed).toEqual([failedStep]);
    });
  });

  it("InstallingPhase renders the failed step name in its error panel (Req 9.3)", () => {
    const src = readFileSync(INSTALLING_PHASE_PATH, "utf8");
    // The error panel surfaces the failed step's human label.
    expect(src).toMatch(/error-panel/);
    expect(src).toMatch(/Failed step: \{STEP_LABELS\[error\.phase\]\}/);
  });
});

describe("CompletePhase success screen — Req 9.2", () => {
  it("renders a success outcome (heading, success marker) and the install directory", () => {
    const src = readFileSync(COMPLETE_PHASE_PATH, "utf8");
    // Success heading and the check-mark success glyph (U+2705).
    expect(src).toMatch(/Installation Complete/);
    expect(src).toMatch(/success-icon/);
    expect(src).toMatch(/&#x2705;/);
    // It reports success language and shows the install directory prop.
    expect(src).toMatch(/successfully/);
    expect(src).toMatch(/\{installDir\}/);
  });

  it("only renders when reached (backend returns success on all-pass, Req 9.2)", () => {
    // Contract note: reaching CompletePhase implies every step passed, so the
    // component takes no failure branch — it must not reference an error/failed
    // path. This guards against re-introducing a partial-success success screen.
    const src = readFileSync(COMPLETE_PHASE_PATH, "utf8");
    expect(src).not.toMatch(/error/i);
    expect(src).not.toMatch(/\bfail/i);
  });
});
