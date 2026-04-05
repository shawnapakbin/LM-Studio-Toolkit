import { ErrorCode, OperationTimer, createErrorResponse, generateTraceId } from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { handleRAGRequest } from "./rag";
import type { RagRequest } from "./types";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const PORT = Number(process.env.PORT ?? 3339);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-rag-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "rag_knowledge",
    description:
      "Persistent RAG tool for document ingest, retrieval, source listing, deletion, and reindexing with approval-gated writes.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "ingest_documents",
            "query_knowledge",
            "list_sources",
            "delete_source",
            "reindex_source",
          ],
          description: "Operation to perform.",
        },
        payload: {
          type: "object",
          description: "Action-specific payload.",
        },
      },
      required: ["action", "payload"],
    },
  });
});

app.post(
  "/tools/rag_knowledge",
  async (req: Request<unknown, unknown, RagRequest>, res: Response) => {
    const timer = new OperationTimer();
    const traceId = generateTraceId();

    try {
      const response = await handleRAGRequest(req.body);
      const statusCode = response.success
        ? 200
        : response.errorCode === ErrorCode.NOT_FOUND
          ? 404
          : response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : 400;
      const responseData =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : {};

      res.status(statusCode).json({
        ...response,
        ...responseData,
        timingMs: response.timingMs ?? timer.elapsed(),
        traceId: response.traceId ?? traceId,
        error: response.errorMessage,
      });
    } catch {
      const error = createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        "Unexpected RAG tool execution error.",
        timer.elapsed(),
        traceId,
      );

      res.status(500).json({ ...error, error: error.errorMessage });
    }
  },
);

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio RAG Tool listening on http://localhost:${PORT}`);
  });
}
