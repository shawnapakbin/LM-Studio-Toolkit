import { spawnSync } from "child_process";

export const PYTHON_INSTALL_URL = "https://www.python.org/downloads/";

export type PythonLauncher = {
  command: string;
  baseArgs: string[];
  source: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
) => { status: number | null; stdout: string; stderr: string };

export type PythonDetection = {
  installed: boolean;
  isPython3: boolean;
  launcher?: PythonLauncher;
  resolvedPath?: string;
  version?: string;
  checked: string[];
  message: string;
  instructions: string;
};

const isWindows = process.platform === "win32";

function defaultRunner(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: isWindows,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parsePythonVersion(text: string): string | null {
  const match = text.match(/Python\s+([0-9]+(?:\.[0-9]+){1,2})/i);
  return match?.[1] ?? null;
}

function isPython3Version(version?: string): boolean {
  if (!version) return false;
  return version.startsWith("3.");
}

function resolveExecutablePath(command: string, run: CommandRunner): string | undefined {
  const locator = isWindows ? "where" : "which";
  const found = run(locator, [command]);
  if (found.status !== 0) {
    return undefined;
  }

  const firstLine = `${found.stdout}\n${found.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || undefined;
}

function buildCandidates(): PythonLauncher[] {
  if (isWindows) {
    return [
      { command: "py", baseArgs: ["-3"], source: "py -3" },
      { command: "python", baseArgs: [], source: "python" },
      { command: "python3", baseArgs: [], source: "python3" },
    ];
  }

  return [
    { command: "python3", baseArgs: [], source: "python3" },
    { command: "python", baseArgs: [], source: "python" },
  ];
}

export function getPythonInstallInstructions(): string {
  if (isWindows) {
    return [
      "Python 3 was not detected.",
      `Install Python from ${PYTHON_INSTALL_URL}`,
      "On Windows, enable 'Add python.exe to PATH' during setup.",
      "After install, restart LM Studio or your terminal session.",
    ].join(" ");
  }

  return [
    "Python 3 was not detected.",
    `Install Python from ${PYTHON_INSTALL_URL}`,
    "After install, restart LM Studio or your terminal session.",
  ].join(" ");
}

export function detectPythonEnvironment(run: CommandRunner = defaultRunner): PythonDetection {
  if (process.env.PYTHON_SHELL_FORCE_MISSING === "1") {
    return {
      installed: false,
      isPython3: false,
      checked: [],
      message: "Python 3 detection is forced to missing by environment override.",
      instructions: getPythonInstallInstructions(),
    };
  }

  const checked: string[] = [];
  const candidates = buildCandidates();

  for (const launcher of candidates) {
    const versionArgs = [...launcher.baseArgs, "--version"];
    checked.push(`${launcher.command} ${versionArgs.join(" ")}`.trim());

    const result = run(launcher.command, versionArgs);
    if (result.status !== 0) {
      continue;
    }

    const output = `${result.stdout}\n${result.stderr}`.trim();
    const version = parsePythonVersion(output);
    const python3 = isPython3Version(version ?? undefined);

    if (!version || !python3) {
      continue;
    }

    return {
      installed: true,
      isPython3: true,
      launcher,
      resolvedPath: resolveExecutablePath(launcher.command, run),
      version,
      checked,
      message: `Detected Python ${version} via '${launcher.source}'.`,
      instructions: "",
    };
  }

  return {
    installed: false,
    isPython3: false,
    checked,
    message: "Python 3 executable was not found in common command locations.",
    instructions: getPythonInstallInstructions(),
  };
}
