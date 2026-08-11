declare module "llm-toolkit-calculator/dist/calculator" {
  export interface EvaluateInput {
    expression: string;
    precision: number;
  }

  export interface EvaluateResult {
    [key: string]: unknown;
    success: boolean;
    expression: string;
    normalizedExpression: string;
    precision: number;
    value: string;
    error?: string;
  }

  export function evaluateExpression(input: EvaluateInput): EvaluateResult;
}

declare module "llm-toolkit-clock/dist/clock" {
  export interface ClockInput {
    timeZone?: string;
    locale?: string;
  }

  export interface ClockResult {
    success: boolean;
    [key: string]: unknown;
  }

  export function getClockSnapshot(input: ClockInput): ClockResult;
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

  export interface DocumentReadResult {
    [key: string]: unknown;
    success: boolean;
    source: "remote" | "local";
    sourceRef: string;
    format: string;
    title: string;
    content: string;
    contentLength: number;
    isEncrypted: boolean;
    error?: string;
    errorCode?: string;
  }

  export function readDocument(input: ReadDocumentInput): Promise<DocumentReadResult>;
}
