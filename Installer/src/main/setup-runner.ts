import { extractPayloadToInstallRoot, getPackagedPayloadRoot, inspectPayload } from "./bootstrap";
import { ensureEnvState } from "./env-manager";
import { getLmStudioInstallationStatus, verifyLmStudio } from "./lmstudio-sync";
import { ensureRuntimeReady, spawnNpmCommand } from "./runtime-manager";
import { getToolStatuses } from "./tool-status";
import type { InstallContext, SetupLogEvent, SetupProgressEvent } from "./types";

const TOTAL_STEPS = 7;

export interface SetupRunnerHandlers {
  onProgress: (event: SetupProgressEvent) => void;
  onLog: (event: SetupLogEvent) => void;
}

function emitProgress(
  handlers: SetupRunnerHandlers,
  step: number,
  phase: SetupProgressEvent["phase"],
  level: SetupProgressEvent["level"],
  message: string,
  phaseProgress = 0,
) {
  handlers.onProgress({ step, phase, level, message, totalSteps: TOTAL_STEPS, phaseProgress });
}

function runProcess(
  handlers: SetupRunnerHandlers,
  args: string[],
  cwd: string,
  step: number,
  phase: SetupProgressEvent["phase"],
  signal?: AbortSignal,
  options?: { envOverrides?: Record<string, string> },
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnNpmCommand(
      args,
      cwd,
      (line) => handlers.onLog({ stream: "stdout", line }),
      (line) => handlers.onLog({ stream: "stderr", line }),
      options,
    );

    const abortListener = () => {
      child.kill();
      reject(new Error("Setup canceled by user."));
    };
    signal?.addEventListener("abort", abortListener, { once: true });

    child.on("exit", (code) => {
      signal?.removeEventListener("abort", abortListener);
      if (code === 0) {
        emitProgress(handlers, step, phase, "ok", `npm ${args.join(" ")} completed.`, 100);
        resolve();
        return;
      }

      reject(new Error(`npm ${args.join(" ")} failed with exit code ${code ?? -1}.`));
    });
  });
}

export async function runSetup(context: InstallContext, handlers: SetupRunnerHandlers, signal?: AbortSignal) {
  emitProgress(handlers, 1, "bootstrap", "section", "Inspecting packaged installer resources", 10);
  const payloadInfo = inspectPayload();
  if (!payloadInfo.exists) {
    emitProgress(
      handlers,
      1,
      "bootstrap",
      "warn",
      `Payload directory not found at ${getPackagedPayloadRoot()}. Development mode will operate against the selected install root only.`,
      20,
    );
  } else {
    emitProgress(
      handlers,
      1,
      "bootstrap",
      "ok",
      `Payload directory detected with ${payloadInfo.entries.length} entries.`,
      25,
    );
  }

  emitProgress(handlers, 1, "bootstrap", "info", "Preparing install root from packaged payload.", 40);
  extractPayloadToInstallRoot(context.installRoot, {
    onProgress: (message) => emitProgress(handlers, 1, "bootstrap", "info", message, 55),
    onLog: (line) => handlers.onLog({ stream: "stdout", line }),
  });

  emitProgress(handlers, 1, "bootstrap", "info", "Ensuring runtime dependencies are available.", 70);
  const runtimeStatus = ensureRuntimeReady((line) => handlers.onLog({ stream: "stdout", line }), {
    allowDownload: context.allowDownloads,
  });
  if (runtimeStatus.mode === "missing") {
    throw new Error("Runtime download is required before installation can continue. Grant download permission and retry.");
  }
  emitProgress(handlers, 1, "bootstrap", "ok", "Runtime dependencies are available.", 100);

  emitProgress(handlers, 2, "env", "section", "Preparing environment configuration", 25);
  ensureEnvState(context.installRoot);
  emitProgress(handlers, 2, "env", "ok", ".env is ready.", 100);

  if (!context.allowDownloads) {
    throw new Error("Package downloads were not authorized. Review the installer actions, grant permission, and retry.");
  }

  emitProgress(handlers, 3, "install", "section", "Installing workspace dependencies", 10);
  emitProgress(
    handlers,
    3,
    "install",
    "info",
    "Skipping Playwright browser binary downloads during install to reduce disk usage. Browser assets can be installed later if needed.",
    15,
  );
  await runProcess(handlers, ["install"], context.installRoot, 3, "install", signal);

  if (context.installPlaywrightBrowsers) {
    emitProgress(
      handlers,
      3,
      "install",
      "info",
      "Installing Playwright Chromium browser binaries for the WebBrowser MCP tool.",
      65,
    );
    await runProcess(
      handlers,
      ["run", "-w", "WebBrowser", "postinstall"],
      context.installRoot,
      3,
      "install",
      signal,
      { envOverrides: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0" } },
    );
  } else {
    emitProgress(
      handlers,
      3,
      "install",
      "warn",
      "Skipped Playwright browser binary installation. WebBrowser MCP may need browser install later.",
      65,
    );
  }

  emitProgress(handlers, 4, "build", "section", "Building toolkit packages", 10);
  await runProcess(handlers, ["run", "build"], context.installRoot, 4, "build", signal);

  emitProgress(handlers, 5, "verify", "section", "Verifying tool binaries", 20);
  const statuses = getToolStatuses(context.installRoot);
  for (const status of statuses) {
    handlers.onLog({
      stream: "stdout",
      line: `[verify] ${status.displayName}: resolved=${status.scriptPath} exists=${status.binaryExists ? "yes" : "no"}`,
    });
  }

  const missing = statuses.filter((status) => !status.binaryExists);
  if (missing.length > 0) {
    for (const status of missing) {
      handlers.onLog({
        stream: "stderr",
        line: `[verify] ${status.displayName} missing. Checked: ${status.checkedPaths.join(" | ")}`,
      });
    }

    throw new Error(`Missing tool binaries: ${missing.map((status) => status.displayName).join(", ")}.`);
  }
  emitProgress(handlers, 5, "verify", "ok", `Verified ${statuses.length} tool binaries.`, 100);

  emitProgress(handlers, 6, "lmstudio", "section", "Syncing LM Studio bridge configs", 20);
  const lmStudioInstall = getLmStudioInstallationStatus();
  handlers.onLog({
    stream: "stdout",
    line: `[lmstudio] appInstalled=${lmStudioInstall.appInstalled ? "yes" : "no"} appPath=${lmStudioInstall.appPath ?? "n/a"}`,
  });
  handlers.onLog({
    stream: "stdout",
    line: `[lmstudio] pluginRoot=${lmStudioInstall.pluginRoot} exists=${lmStudioInstall.pluginRootExists ? "yes" : "no"}`,
  });
  const lmStudioStatus = verifyLmStudio(context.installRoot);
  handlers.onLog({
    stream: "stdout",
    line: `[lmstudio] sync result updated=${lmStudioStatus.updated} skipped=${lmStudioStatus.skipped}`,
  });
  emitProgress(
    handlers,
    6,
    "lmstudio",
    lmStudioStatus.mode === "ready" ? "ok" : "warn",
    lmStudioStatus.message,
    100,
  );

  emitProgress(handlers, 7, "verify", "ok", context.repair ? "Repair completed." : "Install completed.", 100);
  return {
    toolStatuses: statuses,
    lmStudioStatus,
  };
}