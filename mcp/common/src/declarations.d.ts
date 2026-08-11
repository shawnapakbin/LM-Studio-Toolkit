declare module "llm-toolkit-ask-user/dist/ask-user" {
  import type { AskUserRequest } from "llm-toolkit-ask-user/dist/types";

  interface ToolResponse {
    success: boolean;
    data?: unknown;
    errorMessage?: string;
    [key: string]: unknown;
  }

  export function handleAskUserRequest(
    request: AskUserRequest,
    timingMs: number,
    traceId: string,
  ): ToolResponse;
  export function setActiveUIPort(port: number): void;
  export function getActiveUIPort(): number;
}

declare module "llm-toolkit-ask-user/dist/index" {
  import type { Express } from "express";
  export const app: Express;
}

declare module "llm-toolkit-ask-user/dist/types" {
  export type InterviewStatus = "pending" | "answered" | "expired" | "cancelled";

  export type ChoiceOption = {
    id: string;
    label: string;
  };

  export type BaseQuestion = {
    id: string;
    prompt: string;
    required?: boolean;
  };

  export type InterviewQuestion = BaseQuestion & {
    type: "text" | "single_choice" | "multi_choice" | "number" | "confirm";
    options?: ChoiceOption[];
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    integerOnly?: boolean;
    minSelections?: number;
    maxSelections?: number;
  };

  export type InterviewResponse = {
    questionId: string;
    value: string | string[] | number | boolean;
  };

  export type CreateInterviewInput = {
    title?: string;
    taskRunId?: string;
    expiresInSeconds?: number;
    questions: InterviewQuestion[];
  };

  export type SubmitResponsesInput = {
    interviewId: string;
    responses: InterviewResponse[];
  };

  export type GetInterviewInput = {
    interviewId: string;
  };

  export type AskUserAction = "create" | "submit" | "get";

  export type AskUserRequest = {
    action: AskUserAction;
    payload: CreateInterviewInput | SubmitResponsesInput | GetInterviewInput;
  };
}

declare module "llm-toolkit-document-scraper/dist/document-scraper" {
  export interface ReadDocumentInput {
    url?: string;
    filePath?: string;
    headers?: Record<string, string>;
    cookies?: string;
    timeoutMs?: number;
    maxContentChars?: number;
    formatHint?: string;
    profile?: "mvp" | "premium";
    pdfPassword?: string;
  }

  interface DocumentResult {
    success: boolean;
    content?: string;
    error?: string;
    errorCode?: string;
    isEncrypted?: boolean;
    [key: string]: unknown;
  }

  export function readDocument(input: ReadDocumentInput): Promise<DocumentResult>;
}
