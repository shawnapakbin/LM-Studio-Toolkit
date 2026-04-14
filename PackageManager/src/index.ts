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
  AuditVulnerabilitiesSchema,
  DetectPackageManagerSchema,
  InstallPackagesSchema,
  ListOutdatedSchema,
  LockDependenciesSchema,
  RemoveDependenciesSchema,
  UpdatePackagesSchema,
  ViewDependenciesSchema,
  auditVulnerabilities,
  detectPackageManager,
  installPackages,
  listOutdated,
  lockDependencies,
  removeDependencies,
  updatePackages,
  viewDependencies,
} from "./package-manager";
import {
  checkRateLimit,
  getPackageManagerWorkspaceRoot,
  isOperationSupported,
  validatePackageNames,
} from "./policy";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3012;
const WORKSPACE_ROOT = getPackageManagerWorkspaceRoot();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

app.use(cors());
app.use(express.json());

console.log(`📦 PackageManager workspace: ${WORKSPACE_ROOT}`);

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "healthy", workspace: WORKSPACE_ROOT });
});

// Detect package manager
app.post("/tools/detect_package_manager", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    DetectPackageManagerSchema.parse(req.body);
    const rateCheck = checkRateLimit("detect_package_manager");
    if (!rateCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          rateCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await detectPackageManager(WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// Install packages
app.post("/tools/install_packages", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = InstallPackagesSchema.parse(req.body);

    const pkgCheck = validatePackageNames(input.packages);
    if (!pkgCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          pkgCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const rateCheck = checkRateLimit("install_packages");
    if (!rateCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          rateCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    // Detect package manager
    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const opCheck = isOperationSupported(detection.detected.manager, "install");
    if (!opCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.POLICY_BLOCKED, opCheck.reason!, Date.now() - start, traceId),
      );
    }

    const result = await installPackages(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// Update packages
app.post("/tools/update_packages", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = UpdatePackagesSchema.parse(req.body);

    if (input.packages) {
      const pkgCheck = validatePackageNames(input.packages);
      if (!pkgCheck.valid) {
        return res.json(
          createErrorResponse(
            ErrorCode.POLICY_BLOCKED,
            pkgCheck.reason!,
            Date.now() - start,
            traceId,
          ),
        );
      }
    }

    const rateCheck = checkRateLimit("update_packages");
    if (!rateCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          rateCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const opCheck = isOperationSupported(detection.detected.manager, "update");
    if (!opCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.POLICY_BLOCKED, opCheck.reason!, Date.now() - start, traceId),
      );
    }

    const result = await updatePackages(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// Audit vulnerabilities
app.post("/tools/audit_vulnerabilities", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = AuditVulnerabilitiesSchema.parse(req.body);

    const rateCheck = checkRateLimit("audit_vulnerabilities");
    if (!rateCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          rateCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const opCheck = isOperationSupported(detection.detected.manager, "audit");
    if (!opCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.POLICY_BLOCKED, opCheck.reason!, Date.now() - start, traceId),
      );
    }

    const result = await auditVulnerabilities(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// List outdated packages
app.post("/tools/list_outdated", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = ListOutdatedSchema.parse(req.body);

    const rateCheck = checkRateLimit("list_outdated");
    if (!rateCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          rateCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await listOutdated(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// Remove dependencies
app.post("/tools/remove_dependencies", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = RemoveDependenciesSchema.parse(req.body);

    const pkgCheck = validatePackageNames(input.packages);
    if (!pkgCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          pkgCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const rateCheck = checkRateLimit("remove_dependencies");
    if (!rateCheck.valid) {
      return res.json(
        createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          rateCheck.reason!,
          Date.now() - start,
          traceId,
        ),
      );
    }

    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const opCheck = isOperationSupported(detection.detected.manager, "uninstall");
    if (!opCheck.valid) {
      return res.json(
        createErrorResponse(ErrorCode.POLICY_BLOCKED, opCheck.reason!, Date.now() - start, traceId),
      );
    }

    const result = await removeDependencies(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// View dependencies
app.post("/tools/view_dependencies", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = ViewDependenciesSchema.parse(req.body);

    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await viewDependencies(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// Lock dependencies
app.post("/tools/lock_dependencies", async (req, res) => {
  const traceId = generateTraceId();
  const start = Date.now();

  try {
    const input = LockDependenciesSchema.parse(req.body);

    const detection = await detectPackageManager(WORKSPACE_ROOT);
    if (!detection.detected) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "No package manager detected",
          Date.now() - start,
          traceId,
        ),
      );
    }

    const result = await lockDependencies(input, detection.detected.manager, WORKSPACE_ROOT);
    return res.json(createSuccessResponse(result, Date.now() - start, traceId));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.json(
        createErrorResponse(
          ErrorCode.INVALID_INPUT,
          error.errors[0]?.message || "Invalid input",
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

// Start server
const server = app.listen(PORT, () => {
  console.log(`✅ PackageManager HTTP server on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down gracefully...");
  server.close(() => {
    process.exit(0);
  });
});

export default app;
