import {
  ErrorCode,
  createErrorResponse,
  createSuccessResponse,
  generateTraceId,
} from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { z } from "zod";
import { SessionApprovalController } from "../../shared/dist/sessionApproval";
import {
  GitBranchSchema,
  GitCheckoutSchema,
  GitCloneSchema,
  GitCommitSchema,
  GitDiffSchema,
  GitLogSchema,
  GitPullSchema,
  GitPushSchema,
  GitResetSchema,
  GitStashSchema,
  GitStatusSchema,
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
import {
  canForceDeleteBranch,
  canForcePush,
  canHardReset,
  getGitWorkspaceRoot,
  isSafeBranchName,
  validateCloneUrl,
  validateCommitMessage,
  validateRepoPath,
} from "./policy";

dotenv.config();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const app = express();
const PORT = Number(process.env.PORT) || 3011;
const WORKSPACE_ROOT = getGitWorkspaceRoot();
const approval = new SessionApprovalController({
  toolName: "Git",
  askUserEndpoint: process.env.GIT_ASK_USER_ENDPOINT,
  bypassEnvVarName: "GIT_BYPASS_APPROVAL",
});

app.use(cors());
app.use(express.json());

console.log(`🔧 Git tool workspace: ${WORKSPACE_ROOT}`);

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "healthy", workspace: WORKSPACE_ROOT });
});

// Git status
app.post("/tools/git_status", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = GitStatusSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    const result = await gitStatus(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git diff
app.post("/tools/git_diff", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = GitDiffSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    const result = await gitDiff(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git log
app.post("/tools/git_log", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = GitLogSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    const result = await gitLog(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git branch
app.post("/tools/git_branch", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitBranchSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    // Validate branch name for create/delete
    if (input.name) {
      const nameCheck = isSafeBranchName(input.name);
      if (!nameCheck.safe) {
        return res.json(
          createErrorResponse(
            ErrorCode.POLICY_BLOCKED,
            nameCheck.reason!,
            Date.now() - start,
            traceId,
          ),
        );
      }
    }

    // Check force delete policy
    if (input.action === "delete" && input.force && input.name) {
      const forceCheck = canForceDeleteBranch(input.name);
      if (!forceCheck.allowed) {
        return res.json(
          createErrorResponse(
            ErrorCode.POLICY_BLOCKED,
            forceCheck.reason!,
            Date.now() - start,
            traceId,
          ),
        );
      }
    }

    if (input.action !== "list") {
      const gate = await approval.ensureApproved({
        action: `git:git_branch:${input.action}`,
        details: `Branch action '${input.action}' will be executed${input.name ? ` for '${input.name}'` : ""}.`,
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        const status =
          gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
            ? 200
            : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
              ? 403
              : gate.response.errorCode === ErrorCode.INVALID_INPUT
                ? 400
                : 500;
        return res.status(status).json(gate.response);
      }
    }

    const result = await gitBranch(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git checkout
app.post("/tools/git_checkout", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitCheckoutSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    if (input.createBranch) {
      const nameCheck = isSafeBranchName(input.target);
      if (!nameCheck.safe) {
        return res.json(
          createErrorResponse(
            ErrorCode.POLICY_BLOCKED,
            nameCheck.reason!,
            Date.now() - start,
            traceId,
          ),
        );
      }
    }

    const gate = await approval.ensureApproved({
      action: "git:git_checkout",
      details: `Git checkout will switch to '${input.target}'${input.createBranch ? " and create a new branch" : ""}.`,
      approvalToken,
      approvalInterviewId,
      sessionId,
      taskRunId,
    });
    if (!gate.ok) {
      const status =
        gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
          ? 200
          : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : gate.response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : 500;
      return res.status(status).json(gate.response);
    }

    const result = await gitCheckout(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git commit
app.post("/tools/git_commit", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitCommitSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    const messageCheck = validateCommitMessage(input.message);
    if (!messageCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          messageCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const gate = await approval.ensureApproved({
      action: "git:git_commit",
      details: `A git commit will be created with message '${input.message}'.`,
      approvalToken,
      approvalInterviewId,
      sessionId,
      taskRunId,
    });
    if (!gate.ok) {
      const status =
        gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
          ? 200
          : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : gate.response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : 500;
      return res.status(status).json(gate.response);
    }

    const result = await gitCommit(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git push
app.post("/tools/git_push", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitPushSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    if (input.force && input.branch) {
      const forceCheck = canForcePush(input.branch);
      if (!forceCheck.allowed) {
        return res.json(
          createErrorResponse(
            ErrorCode.POLICY_BLOCKED,
            forceCheck.reason!,
            Date.now() - start,
            traceId,
          ),
        );
      }
    }

    const gate = await approval.ensureApproved({
      action: "git:git_push",
      details: `Git push will run${input.branch ? ` for branch '${input.branch}'` : ""}${input.force ? " with force" : ""}.`,
      approvalToken,
      approvalInterviewId,
      sessionId,
      taskRunId,
    });
    if (!gate.ok) {
      const status =
        gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
          ? 200
          : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : gate.response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : 500;
      return res.status(status).json(gate.response);
    }

    const result = await gitPush(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git pull
app.post("/tools/git_pull", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitPullSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    const gate = await approval.ensureApproved({
      action: "git:git_pull",
      details: `Git pull will run${input.branch ? ` for branch '${input.branch}'` : ""}${input.rebase ? " using rebase" : ""}.`,
      approvalToken,
      approvalInterviewId,
      sessionId,
      taskRunId,
    });
    if (!gate.ok) {
      const status =
        gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
          ? 200
          : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : gate.response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : 500;
      return res.status(status).json(gate.response);
    }

    const result = await gitPull(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git clone
app.post("/tools/git_clone", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitCloneSchema.parse(req.body);

    const urlCheck = validateCloneUrl(input.url);
    if (!urlCheck.safe) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          urlCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const gate = await approval.ensureApproved({
      action: "git:git_clone",
      details: `Repository '${input.url}' will be cloned into workspace.`,
      approvalToken,
      approvalInterviewId,
      sessionId,
      taskRunId,
    });
    if (!gate.ok) {
      const status =
        gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
          ? 200
          : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : gate.response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : 500;
      return res.status(status).json(gate.response);
    }

    const result = await gitClone(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git stash
app.post("/tools/git_stash", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitStashSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    if (input.action !== "list") {
      const gate = await approval.ensureApproved({
        action: `git:git_stash:${input.action}`,
        details: `Git stash action '${input.action}' will modify stash/worktree state.`,
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        const status =
          gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
            ? 200
            : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
              ? 403
              : gate.response.errorCode === ErrorCode.INVALID_INPUT
                ? 400
                : 500;
        return res.status(status).json(gate.response);
      }
    }

    const result = await gitStash(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

// Git reset
app.post("/tools/git_reset", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const approvalToken = req.body?.approvalToken as string | undefined;
    const approvalInterviewId = req.body?.approvalInterviewId as string | undefined;
    const sessionId = req.body?.sessionId as string | undefined;
    const taskRunId = req.body?.taskRunId as string | undefined;
    const input = GitResetSchema.parse(req.body);
    const repoCheck = validateRepoPath(WORKSPACE_ROOT);
    if (!repoCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.INVALID_INPUT, repoCheck.error!, Date.now() - start, traceId),
      );
    }

    if (input.mode === "hard") {
      const resetCheck = canHardReset();
      if (!resetCheck.allowed) {
        return res.json(
          createErrorResponse(
            ErrorCode.POLICY_BLOCKED,
            "Hard reset not allowed",
            Date.now() - start,
            traceId,
          ),
        );
      }
    }

    const gate = await approval.ensureApproved({
      action: `git:git_reset:${input.mode}`,
      details: `Git reset in '${input.mode}' mode will modify repository state${input.target ? ` to '${input.target}'` : ""}.`,
      approvalToken,
      approvalInterviewId,
      sessionId,
      taskRunId,
    });
    if (!gate.ok) {
      const status =
        gate.response.success || gate.response.errorCode === ErrorCode.APPROVAL_REQUIRED
          ? 200
          : gate.response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : gate.response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : 500;
      return res.status(status).json(gate.response);
    }

    const result = await gitReset(input, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0].message,
          Date.now() - start,
          traceId,
        ),
      );
    }
    return res.json(
      createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        getErrorMessage(error),
        Date.now() - start,
        traceId,
      ),
    );
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Git HTTP server running on port ${PORT}`);
});
