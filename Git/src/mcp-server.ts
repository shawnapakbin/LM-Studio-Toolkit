// @ts-nocheck -- MCP SDK Zod type recursion causes OOM/TS2589 with many registerTool calls
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import {
  gitBranch,
  gitCheckout,
  gitClone,
  gitCommit,
  gitDiff,
  gitLog,
  gitPull,
  gitPush,
  gitReset,
  gitStash,
  gitStatus,
} from "./git";
import { getGitWorkspaceRoot } from "./policy";

dotenv.config();

const server = new McpServer({
  name: "git-tool",
  version: "1.0.0",
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// git_status
server.registerTool(
  "git_status",
  {
    description:
      "View Git repository status and modified files. Shows staged, unstaged, and untracked files.",
    inputSchema: {
      short: z
        .boolean()
        .optional()
        .describe("Use short format for concise output (default: false)"),
    },
  },
  async ({ short }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitStatus({ short }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git status failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_diff
server.registerTool(
  "git_diff",
  {
    description:
      "View Git diff showing changes between commits, branches, or working directory. Shows line-by-line changes.",
    inputSchema: {
      target: z
        .string()
        .optional()
        .describe("Branch/commit to diff against (e.g., 'main', 'HEAD~1')"),
      staged: z.boolean().optional().describe("Show staged changes only (git diff --staged)"),
      file: z.string().optional().describe("Limit diff to specific file path"),
    },
  },
  async ({ target, staged, file }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitDiff({ target, staged, file }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git diff failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_log
server.registerTool(
  "git_log",
  {
    description:
      "View Git commit history with filtering options. Shows commit hashes, messages, authors, and dates.",
    inputSchema: {
      maxCount: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum commits to show (default: 10)"),
      branch: z.string().optional().describe("Branch to show log for (default: current branch)"),
      file: z.string().optional().describe("Show log for specific file path only"),
      oneline: z
        .boolean()
        .optional()
        .describe("Use oneline format for concise output (default: false)"),
    },
  },
  async ({ maxCount, branch, file, oneline }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitLog({ maxCount, branch, file, oneline }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git log failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_branch
server.registerTool(
  "git_branch",
  {
    description:
      "Manage Git branches: list all branches, create new branches, or delete branches. Protected branches (main/master/production) cannot be force-deleted.",
    inputSchema: {
      action: z
        .enum(["list", "create", "delete"])
        .describe(
          "Action to perform: 'list' (show all branches), 'create' (new branch), 'delete' (remove branch)",
        ),
      name: z.string().optional().describe("Branch name (required for create/delete actions)"),
      force: z
        .boolean()
        .optional()
        .describe("Force delete unmerged branch (default: false, blocked for protected branches)"),
    },
  },
  async ({ action, name, force }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitBranch({ action, name, force }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git branch failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_checkout
server.registerTool(
  "git_checkout",
  {
    description: "Switch to a different branch or commit. Can create a new branch while switching.",
    inputSchema: {
      target: z.string().describe("Branch name or commit hash to checkout"),
      createBranch: z
        .boolean()
        .optional()
        .describe("Create new branch before checkout (default: false)"),
    },
  },
  async ({ target, createBranch }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitCheckout({ target, createBranch }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git checkout failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_commit
server.registerTool(
  "git_commit",
  {
    description:
      "Create a Git commit with validation. Commit messages must be at least 3 characters and avoid placeholders (wip, todo, fixme). First line should be â‰¤100 chars.",
    inputSchema: {
      message: z
        .string()
        .min(3)
        .describe("Commit message (min 3 chars, first line â‰¤100 chars recommended)"),
      all: z.boolean().optional().describe("Stage all changes before commit (git commit -a)"),
      amend: z.boolean().optional().describe("Amend previous commit (default: false)"),
    },
  },
  async ({ message, all, amend }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitCommit({ message, all, amend }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git commit failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_push
server.registerTool(
  "git_push",
  {
    description:
      "Push commits to remote repository. Force push is BLOCKED for protected branches (main/master/production). Set upstream tracking for new branches.",
    inputSchema: {
      remote: z.string().optional().describe("Remote name (default: 'origin')"),
      branch: z.string().optional().describe("Branch to push (default: current)"),
      force: z
        .boolean()
        .optional()
        .describe("Force push (default: false, BLOCKED for protected branches)"),
      setUpstream: z
        .boolean()
        .optional()
        .describe("Set upstream tracking for new branch (default: false)"),
    },
  },
  async ({ remote, branch, force, setUpstream }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitPush({ remote, branch, force, setUpstream }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git push failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_pull
server.registerTool(
  "git_pull",
  {
    description:
      "Pull changes from remote repository. Can use rebase instead of merge to maintain linear history.",
    inputSchema: {
      remote: z.string().optional().describe("Remote name (default: 'origin')"),
      branch: z.string().optional().describe("Branch to pull (default: current)"),
      rebase: z.boolean().optional().describe("Use rebase instead of merge (default: false)"),
    },
  },
  async ({ remote, branch, rebase }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitPull({ remote, branch, rebase }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git pull failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_clone
server.registerTool(
  "git_clone",
  {
    description:
      "Clone a Git repository. Only HTTPS and SSH URLs are allowed (http:// and file:// are BLOCKED for security). Supports shallow clones for faster downloads.",
    inputSchema: {
      url: z
        .string()
        .describe("Repository URL (https:// or git@ only, http:// and file:// blocked)"),
      directory: z
        .string()
        .optional()
        .describe("Target directory name (default: repo name from URL)"),
      branch: z
        .string()
        .optional()
        .describe("Specific branch to clone (default: remote's default branch)"),
      depth: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Shallow clone depth (e.g., 1 for latest commit only)"),
    },
  },
  async ({ url, directory, branch, depth }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitClone({ url, directory, branch, depth }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git clone failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_stash
server.registerTool(
  "git_stash",
  {
    description:
      "Manage Git stash: save uncommitted changes, restore stashed changes, list all stashes, or drop specific stashes. Useful for temporarily saving work.",
    inputSchema: {
      action: z
        .enum(["save", "pop", "list", "drop"])
        .describe(
          "Action: 'save' (stash changes), 'pop' (apply & remove stash), 'list' (show stashes), 'drop' (delete stash)",
        ),
      message: z.string().optional().describe("Stash message for 'save' action"),
      index: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Stash index for 'pop'/'drop' actions (default: 0 = latest)"),
    },
  },
  async ({ action, message, index }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitStash({ action, message, index }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git stash failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// git_reset
server.registerTool(
  "git_reset",
  {
    description:
      "Reset repository to a previous state. SOFT (keep changes staged), MIXED (keep changes unstaged), HARD (discard all changes). HARD mode is DESTRUCTIVE and requires explicit confirmation.",
    inputSchema: {
      mode: z
        .enum(["soft", "mixed", "hard"])
        .describe(
          "Reset mode: 'soft' (keep staged), 'mixed' (keep unstaged), 'hard' (DISCARD ALL)",
        ),
      target: z.string().optional().describe("Commit/branch to reset to (default: 'HEAD')"),
    },
  },
  async ({ mode, target }): Promise<CallToolResult> => {
    const repoPath = getGitWorkspaceRoot();
    try {
      const result = await gitReset({ mode, target }, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Git reset failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Git MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
