import crypto from "crypto";
import { ErrorCode, type ToolResponse, createErrorResponse, createSuccessResponse } from "./types";

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

  requestApproval(action: string, details: string, sessionKey?: string): ToolResponse {
    const approvalToken = this.createApprovalToken(action, "once");
    const sessionApprovalToken = sessionKey
      ? this.createApprovalToken(action, "session", sessionKey)
      : undefined;
    const question = this.buildApprovalQuestion(action, details);
    const sessionNote = sessionApprovalToken
      ? ` To allow for the rest of this session, place the sessionApprovalToken value ("${sessionApprovalToken}") into the approvalToken input field (same field), and include sessionId or taskRunId.`
      : "";

    return createSuccessResponse({
      status: "approval_required",
      action,
      approvalToken,
      ...(sessionApprovalToken ? { sessionApprovalToken } : {}),
      question,
      message: `User approval is required before this operation can proceed. Ask the user: "${question}" - To allow once: retry with approvalToken: "${approvalToken}" in the approvalToken field.${sessionNote}`,
      instructions:
        "Present the question to the user in chat. On confirmation, call this tool again with the same parameters and EITHER: (a) set approvalToken to the approvalToken value shown above for one-time approval, OR (b) set approvalToken to the sessionApprovalToken value shown above AND include sessionId or taskRunId for session-scoped approval. Both options use the same 'approvalToken' input field — do NOT create a separate 'sessionApprovalToken' input field.",
    });
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
            `AskUser service is unreachable at ${this.askUserEndpoint}. Use chat-first approval flow instead: call without approvalInterviewId to receive approvalToken, confirm with user, then retry with approvalToken.`,
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

      if (status === "answered" && approval?.value === "allow_in_session") {
        if (sessionKey) {
          this.addSessionGrant(sessionKey, input.action);
        }
        return { ok: true };
      }

      if (status === "answered" && approval?.value === true) {
        return { ok: true };
      }

      if (status === "pending") {
        return {
          ok: false,
          response: createSuccessResponse({
            status: "approval_pending",
            action: input.action,
            interviewId: input.approvalInterviewId,
            message: "Approval interview has not been answered yet.",
          }),
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

    return {
      ok: false,
      response: this.requestApproval(input.action, input.details, sessionKey),
    };
  }
}
