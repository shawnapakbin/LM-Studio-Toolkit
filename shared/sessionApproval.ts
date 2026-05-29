import crypto from "crypto";
import { ErrorCode, type ToolResponse, createErrorResponse } from "./types";

const DEFAULT_APPROVAL_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_ASK_USER_ENDPOINT = "http://localhost:3338/tools/interview_user";

type PendingApprovalToken = {
  action: string;
  expiresAt: number;
  used: boolean;
  scope?: "once" | "session";
  sessionKey?: string;
};

type ApprovalResponse = {
  questionId?: string;
  value?: unknown;
};

type AskUserResponse = {
  interviewId?: string;
  status?: string;
  responses?: ApprovalResponse[];
  data?: {
    interviewId?: string;
    status?: string;
    responses?: ApprovalResponse[];
  };
};

export type SessionApprovalEnsureInput = {
  action: string;
  details: string;
  approvalInterviewId?: string;
  approvalToken?: string;
  sessionId?: string;
  taskRunId?: string;
};

export type SessionApprovalOptions = {
  toolName: string;
  askUserEndpoint?: string;
  tokenTtlMs?: number;
  bypassEnvVarName?: string;
};

export function normalizeSessionKey(sessionId?: string, taskRunId?: string): string | undefined {
  const sid = sessionId?.trim();
  if (sid) {
    return sid;
  }
  const tid = taskRunId?.trim();
  if (tid) {
    return tid;
  }
  return undefined;
}

export class SessionApprovalController {
  private readonly toolName: string;
  private readonly askUserEndpoint: string;
  private readonly tokenTtlMs: number;
  private readonly bypassEnvVarName?: string;
  private readonly pendingApprovalTokens = new Map<string, PendingApprovalToken>();
  private readonly sessionGrants = new Map<string, Set<string>>();

  constructor(options: SessionApprovalOptions) {
    this.toolName = options.toolName;
    this.askUserEndpoint = options.askUserEndpoint ?? DEFAULT_ASK_USER_ENDPOINT;
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_APPROVAL_TOKEN_TTL_MS;
    this.bypassEnvVarName = options.bypassEnvVarName;
  }

  clearSessionGrants(sessionKey: string): void {
    this.sessionGrants.delete(sessionKey);
  }

  private addSessionGrant(sessionKey: string, action: string): void {
    if (!this.sessionGrants.has(sessionKey)) {
      this.sessionGrants.set(sessionKey, new Set());
    }
    this.sessionGrants.get(sessionKey)!.add(action);
  }

  private createApprovalToken(
    action: string,
    scope: "once" | "session" = "once",
    sessionKey?: string,
  ): string {
    const token = crypto.randomUUID();

    for (const [key, entry] of this.pendingApprovalTokens.entries()) {
      if (entry.expiresAt <= Date.now() || entry.used) {
        this.pendingApprovalTokens.delete(key);
      }
    }

    this.pendingApprovalTokens.set(token, {
      action,
      expiresAt: Date.now() + this.tokenTtlMs,
      used: false,
      scope,
      sessionKey,
    });
    return token;
  }

  private redeemApprovalToken(
    token: string,
    action: string,
    sessionKey?: string,
  ): { ok: true } | { ok: false; reason: string } {
    const entry = this.pendingApprovalTokens.get(token);
    if (!entry) {
      return { ok: false, reason: "Approval token not found or already used." };
    }
    if (entry.used && entry.scope !== "session") {
      return { ok: false, reason: "Approval token has already been used." };
    }
    if (entry.expiresAt <= Date.now()) {
      this.pendingApprovalTokens.delete(token);
      return { ok: false, reason: "Approval token has expired. Please request a new one." };
    }
    if (entry.action !== action) {
      return {
        ok: false,
        reason: `Approval token was issued for '${entry.action}', not '${action}'.`,
      };
    }

    if (entry.scope === "session") {
      const effectiveSession = sessionKey ?? entry.sessionKey;
      if (effectiveSession) {
        this.addSessionGrant(effectiveSession, action);
      } else {
        entry.used = true;
      }
    } else {
      entry.used = true;
    }

    return { ok: true };
  }

  private buildApprovalQuestion(action: string, details: string): string {
    return `Approve '${action}' in ${this.toolName}? ${details}`;
  }

  private async createApprovalInterview(action: string, details: string): Promise<string | null> {
    const interviewId = crypto.randomUUID();
    try {
      const response = await fetch(this.askUserEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          payload: {
            id: interviewId,
            title: `Approve '${action}'`,
            expiresInSeconds: 900,
            questions: [
              {
                id: "approve",
                type: "single_choice",
                prompt: details || "Do you want to allow this action?",
                required: true,
                options: [
                  { id: "allow_once", label: "\u2705 Allow once" },
                  { id: "allow_session", label: "\u2705 Allow for this session" },
                  { id: "deny", label: "\u274c Deny" },
                ],
              },
            ],
          },
        }),
      });
      if (!response.ok) return null;
      return interviewId;
    } catch {
      return null;
    }
  }

  requestApproval(
    action: string,
    details: string,
    sessionKey?: string,
    interviewId?: string,
  ): ToolResponse {
    const approvalToken = this.createApprovalToken(action, "once");
    const sessionApprovalToken = sessionKey
      ? this.createApprovalToken(action, "session", sessionKey)
      : undefined;
    const question = this.buildApprovalQuestion(action, details);

    const submitInstruction = interviewId
      ? `When the user selects an option, call \`interview_user\` with \`action="submit"\`, \`payload.interviewId="${interviewId}"\`, and \`payload.responses=[{questionId:"approve", value:"allow_once" | "allow_session" | "deny"}]\`. Then retry this tool with the SAME parameters plus \`approvalInterviewId="${interviewId}"\`.`
      : `When the user types **proceed** (or **yes**) in chat, call this tool again with the SAME parameters. You may also include the \`approvalToken\` in the payload to approve without a user reply.`;

    return {
      success: false,
      errorCode: ErrorCode.APPROVAL_REQUIRED,
      errorMessage: "User approval is required before this operation can proceed.",
      data: {
        status: "approval_required",
        action,
        approvalToken,
        ...(sessionApprovalToken ? { sessionApprovalToken } : {}),
        ...(interviewId ? { approvalInterviewId: interviewId } : {}),
        question,
        message: `User approval is required before this operation can proceed.`,
        instructions: `Present this EXACT markdown to the user in chat:\n\n**Approval Required**\n${question}\n\n1. ✅ Allow once\n2. ✅ Allow for this session\n3. ❌ Deny\n\nDO NOT SHOW THE TOKENS TO THE USER. ${submitInstruction}`,
      },
    };
  }

  async ensureApproved(
    input: SessionApprovalEnsureInput,
  ): Promise<{ ok: true } | { ok: false; response: ToolResponse }> {
    const sessionKey = normalizeSessionKey(input.sessionId, input.taskRunId);

    if (sessionKey && this.sessionGrants.get(sessionKey)?.has(input.action)) {
      return { ok: true };
    }

    if (this.bypassEnvVarName) {
      const value = process.env[this.bypassEnvVarName];
      if (value === "true" || value === "1") {
        return { ok: true };
      }
    }

    if (input.approvalToken) {
      const result = this.redeemApprovalToken(input.approvalToken, input.action, sessionKey);
      if (result.ok) {
        return { ok: true };
      }
      return {
        ok: false,
        response: createErrorResponse(ErrorCode.POLICY_BLOCKED, result.reason),
      };
    }

    if (input.approvalInterviewId) {
      let response: Response;
      try {
        response = await fetch(this.askUserEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get",
            payload: { interviewId: input.approvalInterviewId },
          }),
        });
      } catch {
        return {
          ok: false,
          response: createErrorResponse(
            ErrorCode.EXECUTION_FAILED,
            `AskUser service is unreachable at ${this.askUserEndpoint}. Retry without approvalInterviewId to receive a new approval prompt.`,
          ),
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          response: createErrorResponse(
            ErrorCode.EXECUTION_FAILED,
            "Unable to verify approval interview via AskUser.",
          ),
        };
      }

      const body = (await response.json()) as AskUserResponse;
      const status = body?.status || body?.data?.status;
      const responses = body?.responses || body?.data?.responses || [];
      const approval = Array.isArray(responses)
        ? responses.find((item) => item?.questionId === "approve")
        : undefined;

      if (status === "answered" && (approval?.value === "allow_once" || approval?.value === true)) {
        return { ok: true };
      }

      if (
        status === "answered" &&
        (approval?.value === "allow_session" || approval?.value === "allow_in_session")
      ) {
        if (sessionKey) {
          this.addSessionGrant(sessionKey, input.action);
        }
        return { ok: true };
      }

      if (status === "answered" && approval?.value === "deny") {
        return {
          ok: false,
          response: createErrorResponse(ErrorCode.POLICY_BLOCKED, "Action was denied by user."),
        };
      }

      if (status === "pending") {
        return {
          ok: false,
          response: {
            success: false,
            errorCode: ErrorCode.APPROVAL_REQUIRED,
            errorMessage: "Approval interview has not been answered yet.",
            data: {
              status: "approval_pending",
              action: input.action,
              interviewId: input.approvalInterviewId,
              message: "Approval interview has not been answered yet.",
            },
          },
        };
      }

      return {
        ok: false,
        response: createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          "Write operation requires explicit approval and was not approved.",
        ),
      };
    }

    // No prior approval — create an interview form for the user to respond to in chat.
    const interviewId = await this.createApprovalInterview(input.action, input.details);
    return {
      ok: false,
      response: this.requestApproval(
        input.action,
        input.details,
        sessionKey,
        interviewId ?? undefined,
      ),
    };
  }
}
