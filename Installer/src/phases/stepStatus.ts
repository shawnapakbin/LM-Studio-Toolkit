import { InstallStep, STEP_ORDER } from "../types";

/** Visual status of a single provisioning step in the installing UI. */
export type StepStatus = "pending" | "active" | "completed" | "failed";

/**
 * Derive the display status of a provisioning `step` given the current step and
 * the (optional) failed step.
 *
 * Behaviour (Req 9.1 ordering, Req 9.3 fail-fast):
 *   - No error: steps before the current one are "completed", the current one
 *     is "active", and later steps are "pending".
 *   - On error: the failed step is "failed", every step before it is
 *     "completed", and every step at or after it (other than the failed step
 *     itself) stays "pending" so nothing appears to still be running.
 */
export function getStepStatus(
  step: InstallStep,
  currentStep: InstallStep,
  hasError: boolean,
  errorStep?: InstallStep,
): StepStatus {
  const currentIdx = STEP_ORDER.indexOf(currentStep);
  const stepIdx = STEP_ORDER.indexOf(step);

  // On failure the failed step is marked "failed"; every step after it stays
  // "pending" so nothing appears to still be running (Req 9.3).
  if (hasError) {
    const errorIdx = errorStep ? STEP_ORDER.indexOf(errorStep) : -1;
    if (errorStep === step) return "failed";
    if (errorIdx >= 0 && stepIdx < errorIdx) return "completed";
    return "pending";
  }

  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

/** Map a step status to its glyph shown in the step list. */
export function getStatusIcon(status: StepStatus): string {
  switch (status) {
    case "completed":
      return "\u2713";
    case "active":
      return "\u25B6";
    case "failed":
      return "\u2717";
    case "pending":
      return "\u25CB";
  }
}
