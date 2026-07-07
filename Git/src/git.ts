/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import { z } from "zod";

const execAsync = promisify(exec);

export type GitStatusInput = z.infer<typeof GitStatusSchema>;
export type GitDiffInput = z.infer<typeof GitDiffSchema>;
export type GitLogInput = z.infer<typeof GitLogSchema>;
export type GitBranchInput = z.infer<typeof GitBranchSchema>;
export type GitCheckoutInput = z.infer<typeof GitCheckoutSchema>;
export type GitCommitInput = z.infer<typeof GitCommitSchema>;
export type GitPushInput = z.infer<typeof GitPushSchema>;
export type GitPullInput = z.infer<typeof GitPullSchema>;
export type GitCloneInput = z.infer<typeof GitCloneSchema>;
export type GitStashInput = z.infer<typeof GitStashSchema>;
export type GitResetInput = z.infer<typeof GitResetSchema>;

export const GitStatusSchema = z.object({
  short: z.boolean().optional().default(false),
});

export const GitDiffSchema = z.object({
  target: z.string().optional(),
  staged: z.boolean().optional().default(false),
  file: z.string().optional(),
});

export const GitLogSchema = z.object({
  maxCount: z.number().int().positive().optional().default(10),
  branch: z.string().optional(),
  file: z.string().optional(),
  oneline: z.boolean().optional().default(false),
});

export const GitBranchSchema = z.object({
  action: z.enum(["list", "create", "delete"]),
  name: z.string().optional(),
  force: z.boolean().optional().default(false),
});

export const GitCheckoutSchema = z.object({
  target: z.string().min(1, "branch or commit required"),
  createBranch: z.boolean().optional().default(false),
});

export const GitCommitSchema = z.object({
  message: z.string().min(1, "commit message required"),
  all: z.boolean().optional().default(false),
  amend: z.boolean().optional().default(false),
});

export const GitPushSchema = z.object({
  remote: z.string().optional().default("origin"),
  branch: z.string().optional(),
  force: z.boolean().optional().default(false),
  setUpstream: z.boolean().optional().default(false),
});

export const GitPullSchema = z.object({
  remote: z.string().optional().default("origin"),
  branch: z.string().optional(),
  rebase: z.boolean().optional().default(false),
});

export const GitCloneSchema = z.object({
  url: z.string().min(1, "repository URL required"),
  directory: z.string().optional(),
  branch: z.string().optional(),
  depth: z.number().int().positive().optional(),
});

export const GitStashSchema = z.object({
  action: z.enum(["save", "pop", "list", "drop"]),
  message: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
});

export const GitResetSchema = z.object({
  mode: z.enum(["soft", "mixed", "hard"]),
  target: z.string().optional().default("HEAD"),
});

const TIMEOUT_MS = 30000; // 30 seconds

async function runGitCommand(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execAsync(command, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });
    return result;
  } catch (error: unknown) {
    // Git commands may have stderr even on success
    return {
      stdout: error instanceof Error && "stdout" in error ? String(error.stdout ?? "") : "",
      stderr:
        error instanceof Error && "stderr" in error
          ? String(error.stderr ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

/**
 * Get repository status
 */
export async function gitStatus(
  input: GitStatusInput,
  repoPath: string,
): Promise<{ output: string; files: string[] }> {
  const shortFlag = input.short ? "--short" : "";
  const { stdout } = await runGitCommand(`git status ${shortFlag}`, repoPath);

  // Extract modified files
  const files: string[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*(?:modified|new file|deleted|renamed):\s+(.+)$/);
    if (match) files.push(match[1].trim());
  }

  return {
    output: stdout,
    files,
  };
}

/**
 * View diff
 */
export async function gitDiff(
  input: GitDiffInput,
  repoPath: string,
): Promise<{ output: string; filesChanged: number }> {
  let command = "git diff";
  if (input.staged) command += " --staged";
  if (input.target) command += ` ${input.target}`;
  if (input.file) command += ` -- ${input.file}`;

  const { stdout } = await runGitCommand(command, repoPath);

  // Count files changed
  const filesChanged = (stdout.match(/^diff --git/gm) || []).length;

  return {
    output: stdout,
    filesChanged,
  };
}

/**
 * View commit history
 */
export async function gitLog(
  input: GitLogInput,
  repoPath: string,
): Promise<{ output: string; commits: Array<{ hash: string; message: string }> }> {
  let command = `git log --max-count=${input.maxCount}`;
  if (input.oneline) command += " --oneline";
  if (input.branch) command += ` ${input.branch}`;
  if (input.file) command += ` -- ${input.file}`;

  const { stdout } = await runGitCommand(command, repoPath);

  // Parse commits
  const commits: Array<{ hash: string; message: string }> = [];
  if (input.oneline) {
    const lines = stdout.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      if (match) {
        commits.push({ hash: match[1], message: match[2] });
      }
    }
  }

  return {
    output: stdout,
    commits,
  };
}

/**
 * Manage branches
 */
export async function gitBranch(
  input: GitBranchInput,
  repoPath: string,
): Promise<{ output: string; branches?: string[]; current?: string }> {
  let command = "git branch";

  if (input.action === "list") {
    const { stdout } = await runGitCommand(command, repoPath);
    const lines = stdout.split("\n").filter((l) => l.trim());
    const branches = lines.map((l) => l.replace("*", "").trim());
    const current = lines
      .find((l) => l.startsWith("*"))
      ?.replace("*", "")
      .trim();

    return {
      output: stdout,
      branches,
      current,
    };
  }

  if (input.action === "create") {
    if (!input.name) throw new Error("branch name required for create");
    command = `git branch ${input.name}`;
  }

  if (input.action === "delete") {
    if (!input.name) throw new Error("branch name required for delete");
    const flag = input.force ? "-D" : "-d";
    command = `git branch ${flag} ${input.name}`;
  }

  const { stdout } = await runGitCommand(command, repoPath);
  return { output: stdout };
}

/**
 * Checkout branch or commit
 */
export async function gitCheckout(
  input: GitCheckoutInput,
  repoPath: string,
): Promise<{ output: string; branch: string }> {
  let command = "git checkout";
  if (input.createBranch) command += " -b";
  command += ` ${input.target}`;

  const { stdout } = await runGitCommand(command, repoPath);

  // Get current branch
  const { stdout: branchOut } = await runGitCommand("git branch --show-current", repoPath);
  const branch = branchOut.trim();

  return {
    output: stdout,
    branch,
  };
}

/**
 * Create commit
 */
export async function gitCommit(
  input: GitCommitInput,
  repoPath: string,
): Promise<{ output: string; hash: string }> {
  let command = "git commit";
  if (input.all) command += " -a";
  if (input.amend) command += " --amend";
  command += ` -m "${input.message.replace(/"/g, '\\"')}"`;

  const { stdout } = await runGitCommand(command, repoPath);

  // Extract commit hash
  const match = stdout.match(/\[.+\s([a-f0-9]+)\]/);
  const hash = match ? match[1] : "";

  return {
    output: stdout,
    hash,
  };
}

/**
 * Push to remote
 */
export async function gitPush(input: GitPushInput, repoPath: string): Promise<{ output: string }> {
  let command = `git push ${input.remote}`;
  if (input.branch) command += ` ${input.branch}`;
  if (input.force) command += " --force";
  if (input.setUpstream) command += " --set-upstream";

  const { stdout, stderr } = await runGitCommand(command, repoPath);

  return {
    output: stdout || stderr,
  };
}

/**
 * Pull from remote
 */
export async function gitPull(input: GitPullInput, repoPath: string): Promise<{ output: string }> {
  let command = `git pull ${input.remote}`;
  if (input.branch) command += ` ${input.branch}`;
  if (input.rebase) command += " --rebase";

  const { stdout, stderr } = await runGitCommand(command, repoPath);

  return {
    output: stdout || stderr,
  };
}

/**
 * Clone repository
 */
export async function gitClone(
  input: GitCloneInput,
  repoPath: string,
): Promise<{ output: string; directory: string }> {
  let command = `git clone ${input.url}`;
  if (input.directory) command += ` ${input.directory}`;
  if (input.branch) command += ` --branch ${input.branch}`;
  if (input.depth) command += ` --depth ${input.depth}`;

  const { stdout, stderr } = await runGitCommand(command, repoPath);

  // Determine cloned directory
  const directory = input.directory || path.basename(input.url, ".git");

  return {
    output: stdout || stderr,
    directory,
  };
}

/**
 * Stash operations
 */
export async function gitStash(
  input: GitStashInput,
  repoPath: string,
): Promise<{ output: string; stashes?: Array<{ index: number; message: string }> }> {
  let command = "git stash";

  switch (input.action) {
    case "save":
      command += " push";
      if (input.message) command += ` -m "${input.message.replace(/"/g, '\\"')}"`;
      break;
    case "pop":
      command += " pop";
      if (input.index !== undefined) command += ` stash@{${input.index}}`;
      break;
    case "list":
      command += " list";
      break;
    case "drop":
      command += " drop";
      if (input.index !== undefined) command += ` stash@{${input.index}}`;
      break;
  }

  const { stdout } = await runGitCommand(command, repoPath);

  // Parse stash list
  let stashes: Array<{ index: number; message: string }> | undefined;
  if (input.action === "list") {
    stashes = [];
    const lines = stdout.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      const match = line.match(/^stash@\{(\d+)\}:\s+(.+)$/);
      if (match) {
        stashes.push({ index: Number.parseInt(match[1], 10), message: match[2] });
      }
    }
  }

  return {
    output: stdout,
    stashes,
  };
}

/**
 * Reset repository state
 */
export async function gitReset(
  input: GitResetInput,
  repoPath: string,
): Promise<{ output: string }> {
  const command = `git reset --${input.mode} ${input.target}`;
  const { stdout } = await runGitCommand(command, repoPath);

  return {
    output: stdout,
  };
}
