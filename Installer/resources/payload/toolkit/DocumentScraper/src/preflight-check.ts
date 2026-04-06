export type PreflightCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

export function runPreflightChecks(): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  const maxBytes = Number(process.env.DOC_SCRAPER_MAX_CONTENT_BYTES ?? 50 * 1024 * 1024);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    checks.push({
      name: "DOC_SCRAPER_MAX_CONTENT_BYTES",
      status: "warn",
      message: "Invalid DOC_SCRAPER_MAX_CONTENT_BYTES. Falling back to default.",
    });
  } else {
    checks.push({
      name: "DOC_SCRAPER_MAX_CONTENT_BYTES",
      status: "pass",
      message: "Content size cap configured.",
    });
  }

  const workspaceRoot = process.env.DOC_SCRAPER_WORKSPACE_ROOT;
  checks.push({
    name: "DOC_SCRAPER_WORKSPACE_ROOT",
    status: workspaceRoot ? "pass" : "warn",
    message: workspaceRoot
      ? "Workspace root configured."
      : "Workspace root is not set. Using current working directory.",
  });

  return checks;
}
