import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import {
  type CrawlDocumentsInput,
  type ReadDocumentInput,
  crawlDocuments,
  readDocument,
} from "./document-scraper";
import { runPreflightChecks } from "./preflight-check";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));

const PORT = Number(process.env.PORT ?? 3336);

class OperationTimer {
  private readonly startTime = Date.now();
  elapsed(): number {
    return Date.now() - this.startTime;
  }
}

function generateTraceId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

function createSuccessResponse<T>(data: T, timingMs: number, traceId: string) {
  return { success: true, data, timingMs, traceId };
}

function createErrorResponse(
  errorCode: string,
  errorMessage: string,
  timingMs: number,
  traceId: string,
) {
  return { success: false, errorCode, errorMessage, timingMs, traceId };
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "lm-studio-document-scraper-tool",
    preflight: runPreflightChecks(),
  });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "read_document",
    description:
      "Reads local or remote documents and returns extracted text, sections, description, and PDF encryption notifications.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Remote URL to fetch." },
        filePath: { type: "string", description: "Workspace-relative local file path." },
        headers: { type: "object", additionalProperties: { type: "string" } },
        cookies: { type: "string" },
        timeoutMs: { type: "number" },
        maxContentChars: { type: "number" },
        formatHint: { type: "string" },
        profile: { type: "string", enum: ["mvp", "premium"] },
        pdfPassword: { type: "string", description: "Premium mode only." },
      },
      required: [],
    },
  });
});

app.post(
  "/tools/read_document",
  async (req: Request<unknown, unknown, ReadDocumentInput>, res: Response) => {
    const timer = new OperationTimer();
    const traceId = generateTraceId();

    const input = req.body || {};
    const result = await readDocument(input);
    const timingMs = timer.elapsed();

    if (result.success) {
      res.status(200).json(createSuccessResponse(result, timingMs, traceId));
      return;
    }

    const response = createErrorResponse(
      result.errorCode || "EXECUTION_FAILED",
      result.error || "Document read failed",
      timingMs,
      traceId,
    );

    const status =
      result.encryptionStatusCode === "PDF_ENCRYPTED" ||
      result.encryptionStatusCode === "PDF_INVALID_PASSWORD"
        ? 423
        : result.errorCode === "POLICY_BLOCKED"
          ? 403
          : result.errorCode === "NOT_FOUND"
            ? 404
            : 400;

    res.status(status).json({ ...response, data: result, error: response.errorMessage });
  },
);

app.post(
  "/tools/crawl_documents",
  async (req: Request<unknown, unknown, CrawlDocumentsInput>, res: Response) => {
    const timer = new OperationTimer();
    const traceId = generateTraceId();

    if (!req.body?.url) {
      const response = createErrorResponse(
        "INVALID_INPUT",
        "url is required",
        timer.elapsed(),
        traceId,
      );
      res.status(400).json({ ...response, error: response.errorMessage });
      return;
    }

    const result = await crawlDocuments(req.body);
    const timingMs = timer.elapsed();

    if (result.success) {
      res.status(200).json(createSuccessResponse(result, timingMs, traceId));
      return;
    }

    const response = createErrorResponse(
      "EXECUTION_FAILED",
      result.errors[0] || "Crawl completed with errors",
      timingMs,
      traceId,
    );

    res.status(400).json({ ...response, data: result, error: response.errorMessage });
  },
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio Document Scraper Tool listening on http://localhost:${PORT}`);
  });
}

export { app };
