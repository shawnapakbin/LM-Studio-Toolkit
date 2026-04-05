import { extractPayloadToInstallRoot, getPackagedPayloadRoot, inspectPayload } from "./bootstrap";
import { ensureEnvState } from "./env-manager";
import { verifyLmStudio } from "./lmstudio-sync";
import { ensureRuntimeReady, spawnNpmCommand } from "./runtime-manager";
import { getToolStatuses } from "./tool-status";
import type { InstallContext, SetupLogEvent, SetupProgressEvent } from "./types";

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
) {
  handlers.onProgress({ step, phase, level, message });
}

function runProcess(
  handlers: SetupRunnerHandlers,
  args: string[],
  cwd: string,
  step: number,
  phase: SetupProgressEvent["phase"],
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnNpmCommand(
      args,
      cwd,
      (line) => handlers.onLog({ stream: "stdout", line }),
      (line) => handlers.onLog({ stream: "stderr", line }),
    );

    const abortListener = () => {
      child.kill();
      reject(new Error("Setup canceled by user."));
    };
    signal?.addEventListener("abort", abortListener, { once: true });

    child.on("exit", (code) => {
      signal?.removeEventListener("abort", abortListener);
      if (code === 0) {
        emitProgress(handlers, step, phase, "ok", `npm ${args.join(" ")} completed.`);
        resolve();
        return;
      }

      reject(new Error(`npm ${args.join(" ")} failed with exit code ${code ?? -1}.`));
    });
  });
}

export async function runSetup(context: InstallContext, handlers: SetupRunnerHandlers, signal?: AbortSignal) {
  emitProgress(handlers, 1, "bootstrap", "section", "Inspecting packaged installer resources");
  const payloadInfo = inspectPayload();
  if (!payloadInfo.exists) {
    emitProgress(
      handlers,
      1,
      "bootstrap",
      "warn",
      `Payload directory not found at ${getPackagedPayloadRoot()}. Development mode will operate against the selected install root only.`,
    );
  } else {
    emitProgress(
      handlers,
      1,
      "bootstrap",
      "ok",
      `Payload directory detected with ${payloadInfo.entries.length} entries.`,
    );
  }

  emitProgress(handlers, 1, "bootstrap", "info", "Preparing install root from packaged payload.");
  extractPayloadToInstallRoot(context.installRoot, {
    onProgress: (message) => emitProgress(handlers, 1, "bootstrap", "info", message),
    onLog: (line) => handlers.onLog({ stream: "stdout", line }),
  });

  emitProgress(handlers, 1, "bootstrap", "info", "Ensuring runtime dependencies are available.");
  const runtimeStatus = ensureRuntimeReady((line) => handlers.onLog({ stream: "stdout", line }));
  if (runtimeStatus.mode === "missing") {
    throw new Error("Unable to prepare runtime requirements (Node/npm). Install could not continue.");
  }

  emitProgress(handlers, 2, "env", "section", "Preparing environment configuration");
  ensureEnvState(context.installRoot);
  emitProgress(handlers, 2, "env", "ok", ".env is ready.");

  emitProgress(handlers, 3, "install", "section", "Installing workspace dependencies");
  await runProcess(handlers, ["install"], context.installRoot, 3, "install", signal);

  emitProgress(handlers, 4, "build", "section", "Building toolkit packages");
  await runProcess(handlers, ["run", "build"], context.installRoot, 4, "build", signal);

  emitProgress(handlers, 5, "verify", "section", "Verifying tool binaries");
  const statuses = getToolStatuses(context.installRoot);
  const missing = statuses.filter((status) => !status.binaryExists);
  if (missing.length > 0) {
    throw new Error(`Missing tool binaries: ${missing.map((status) => status.displayName).join(", ")}.`);
  }
  emitProgress(handlers, 5, "verify", "ok", `Verified ${statuses.length} tool binaries.`);

  emitProgress(handlers, 6, "lmstudio", "section", "Syncing LM Studio bridge configs");
  const lmStudioStatus = verifyLmStudio(context.installRoot);
  emitProgress(handlers, 6, "lmstudio", lmStudioStatus.mode === "ready" ? "ok" : "warn", lmStudioStatus.message);

  emitProgress(handlers, 7, "verify", "ok", context.repair ? "Repair completed." : "Install completed.");
  return {
    toolStatuses: statuses,
    lmStudioStatus,
  };
}