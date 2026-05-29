import {
  ErrorCode,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shared/types";
import { normalizeExpiresSeconds, validateCreateInput, validateSubmitInput } from "./policy";
import { AskUserStore } from "./store";
import type {
  AskUserRequest,
  CreateInterviewInput,
  GetInterviewInput,
  InterviewQuestion,
  SubmitResponsesInput,
} from "./types";

const DB_PATH = process.env.ASK_USER_DB_PATH ?? "./memory.db";
const store = new AskUserStore(DB_PATH);

function parseQuestions(raw: string): InterviewQuestion[] {
  try {
    return JSON.parse(raw) as InterviewQuestion[];
  } catch {
    return [];
  }
}

function parseResponses(raw: string | null): unknown {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now();
}

function createInterview(
  payload: CreateInterviewInput,
  timingMs: number,
  traceId: string,
): ToolResponse {
  const validationError = validateCreateInput(payload);
  if (validationError) {
    return createErrorResponse(ErrorCode.INVALID_INPUT, validationError, timingMs, traceId);
  }

  const expiresInSeconds = normalizeExpiresSeconds(payload.expiresInSeconds);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const interviewId = store.createInterview({
    title: payload.title,
    taskRunId: payload.taskRunId,
    questions: payload.questions,
    expiresAtIso: expiresAt,
  });

  return createSuccessResponse(
    {
      action: "create",
      interviewId,
      status: "pending",
      expiresAt,
      questionCount: payload.questions.length,
      questions: payload.questions,
    },
    timingMs,
    traceId,
  );
}

function getInterview(payload: GetInterviewInput, timingMs: number, traceId: string): ToolResponse {
  if (!payload.interviewId?.trim()) {
    return createErrorResponse(
      ErrorCode.INVALID_INPUT,
      "'interviewId' is required.",
      timingMs,
      traceId,
    );
  }

  const record = store.getInterview(payload.interviewId);
  if (!record) {
    return createErrorResponse(ErrorCode.NOT_FOUND, "Interview not found.", timingMs, traceId);
  }

  if (record.status === "pending" && isExpired(record.expires_at)) {
    store.markExpired(record.id);
    record.status = "expired";
  }

  return createSuccessResponse(
    {
      action: "get",
      interviewId: record.id,
      title: record.title,
      status: record.status,
      expiresAt: record.expires_at,
      createdAt: record.created_at,
      answeredAt: record.answered_at,
      questions: parseQuestions(record.questions_json),
      responses: parseResponses(record.responses_json),
    },
    timingMs,
    traceId,
  );
}

function submitResponses(
  payload: SubmitResponsesInput,
  timingMs: number,
  traceId: string,
): ToolResponse {
  const record = store.getInterview(payload.interviewId);
  if (!record) {
    return createErrorResponse(ErrorCode.NOT_FOUND, "Interview not found.", timingMs, traceId);
  }

  if (record.status !== "pending") {
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      `Interview is '${record.status}' and no longer accepts responses.`,
      timingMs,
      traceId,
    );
  }

  if (isExpired(record.expires_at)) {
    store.markExpired(record.id);
    return createErrorResponse(ErrorCode.TIMEOUT, "Interview has expired.", timingMs, traceId);
  }

  const questions = parseQuestions(record.questions_json);
  const validationError = validateSubmitInput(payload, questions);
  if (validationError) {
    return createErrorResponse(ErrorCode.INVALID_INPUT, validationError, timingMs, traceId);
  }

  store.saveResponses(record.id, payload.responses);

  return createSuccessResponse(
    {
      action: "submit",
      interviewId: record.id,
      status: "answered",
      answeredAt: new Date().toISOString(),
      responses: payload.responses,
    },
    timingMs,
    traceId,
  );
}

export function handleAskUserRequest(
  request: AskUserRequest,
  timingMs: number,
  traceId: string,
): ToolResponse {
  if (!request || !request.action || !request.payload) {
    return createErrorResponse(
      ErrorCode.INVALID_INPUT,
      "Request must contain 'action' and 'payload'.",
      timingMs,
      traceId,
    );
  }

  if (request.action === "create") {
    return createInterview(request.payload as CreateInterviewInput, timingMs, traceId);
  }

  if (request.action === "submit") {
    return submitResponses(request.payload as SubmitResponsesInput, timingMs, traceId);
  }

  if (request.action === "get") {
    return getInterview(request.payload as GetInterviewInput, timingMs, traceId);
  }

  return createErrorResponse(
    ErrorCode.INVALID_INPUT,
    `Unsupported action '${String(request.action)}'.`,
    timingMs,
    traceId,
  );
}
