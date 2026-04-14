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
import {
  DeleteFileSchema,
  ListDirectorySchema,
  MoveFileSchema,
  ReadFileSchema,
  SearchFilesSchema,
  WriteFileSchema,
  deleteFile,
  listDirectory,
  moveFile,
  readFile,
  searchFiles,
  writeFile,
} from "./file-editor";
import {
  canDelete,
  getWorkspaceRoot,
  isAllowedExtensionForWrite,
  isBlockedPath,
  validateContentSafety,
  validatePath,
} from "./policy";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3010;
const WORKSPACE_ROOT = getWorkspaceRoot();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

app.use(cors());
app.use(express.json());

console.log(`🗂️  FileEditor workspace: ${WORKSPACE_ROOT}`);

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "healthy", workspace: WORKSPACE_ROOT });
});

// Read file
app.post("/tools/read_file", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = ReadFileSchema.parse(req.body);

    // Validate path
    const pathCheck = validatePath(input.path, WORKSPACE_ROOT);
    if (!pathCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          pathCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const blockedCheck = isBlockedPath(input.path);
    if (blockedCheck.blocked) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          blockedCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await readFile(input, WORKSPACE_ROOT);
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

// Write file
app.post("/tools/write_file", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = WriteFileSchema.parse(req.body);

    // Validate path
    const pathCheck = validatePath(input.path, WORKSPACE_ROOT);
    if (!pathCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          pathCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const blockedCheck = isBlockedPath(input.path);
    if (blockedCheck.blocked) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          blockedCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const extCheck = isAllowedExtensionForWrite(input.path);
    if (!extCheck.allowed) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          extCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const contentCheck = validateContentSafety(input.content);
    if (!contentCheck.safe) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          contentCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await writeFile(input, WORKSPACE_ROOT);
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

// Search files
app.post("/tools/search_files", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = SearchFilesSchema.parse(req.body);
    const result = await searchFiles(input, WORKSPACE_ROOT);
    return res.json(
      createSuccessResponse({ results: result, count: result.length }, Date.now() - start, traceId),
    );
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

// List directory
app.post("/tools/list_directory", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = ListDirectorySchema.parse(req.body);
    const pathCheck = validatePath(input.path, WORKSPACE_ROOT);
    if (!pathCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          pathCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await listDirectory(input, WORKSPACE_ROOT);
    return res.json(
      createSuccessResponse({ files: result, count: result.length }, Date.now() - start, traceId),
    );
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

// Delete file
app.post("/tools/delete_file", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = DeleteFileSchema.parse(req.body);

    const pathCheck = validatePath(input.path, WORKSPACE_ROOT);
    if (!pathCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          pathCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const deleteCheck = canDelete(input.path);
    if (!deleteCheck.allowed) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          deleteCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await deleteFile(input, WORKSPACE_ROOT);
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

// Move file
app.post("/tools/move_file", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = MoveFileSchema.parse(req.body);

    const sourceCheck = validatePath(input.source, WORKSPACE_ROOT);
    if (!sourceCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          sourceCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const destCheck = validatePath(input.destination, WORKSPACE_ROOT);
    if (!destCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          destCheck.error!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await moveFile(input, WORKSPACE_ROOT);
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
  console.log(`🚀 FileEditor HTTP server running on port ${PORT}`);
});
