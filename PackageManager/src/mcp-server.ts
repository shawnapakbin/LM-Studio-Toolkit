// @ts-nocheck -- MCP SDK Zod type recursion causes OOM/TS2589 with many registerTool calls
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { SessionApprovalController } from "../../shared/dist/sessionApproval";
import {
  auditVulnerabilities,
  detectPackageManager,
  installPackages,
  listOutdated,
  lockDependencies,
  removeDependencies,
  updatePackages,
  viewDependencies,
} from "./package-manager";
import { getPackageManagerWorkspaceRoot } from "./policy";

dotenv.config();

const approval = new SessionApprovalController({
  toolName: "PackageManager",
  askUserEndpoint: process.env.PACKAGE_MANAGER_ASK_USER_ENDPOINT,
  bypassEnvVarName: "PACKAGE_MANAGER_BYPASS_APPROVAL",
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type InstallPackagesToolInput = {
  packages: string[];
  dev?: boolean;
  global?: boolean;
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

type UpdatePackagesToolInput = {
  packages?: string[];
  all?: boolean;
  check?: boolean;
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

type AuditVulnerabilitiesToolInput = {
  fix?: boolean;
  severity?: "low" | "moderate" | "high" | "critical";
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

type ListOutdatedToolInput = {
  format?: "list" | "json" | "outdated";
};

type RemoveDependenciesToolInput = {
  packages: string[];
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

type ViewDependenciesToolInput = {
  depth?: number;
  onlyDirect?: boolean;
};

type LockDependenciesToolInput = {
  frozen?: boolean;
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

const server = new McpServer({
  name: "package-manager-tool",
  version: "1.0.0",
});

// detect_package_manager
server.registerTool(
  "detect_package_manager",
  {
    description:
      "Detects available package managers and identifies the active project manager from manifest files. Detection coverage includes npm, pip, cargo, maven, gradle, and go; operation support varies by action tool.",
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const result = await detectPackageManager(repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Package manager detection failed: ${getErrorMessage(error)}` },
        ],
      };
    }
  },
);

// install_packages
server.registerTool(
  "install_packages",
  {
    description:
      "Install packages in the project using the detected package manager. Supports action execution for npm, pip, cargo, maven, and go based on current implementation. Gradle may be detected but is not supported for this action in the current release.",
    inputSchema: {
      packages: z
        .array(z.string())
        .min(1)
        .describe("Package names to install (e.g., ['express', 'lodash'])"),
      dev: z.boolean().optional().describe("Install as development dependency (default: false)"),
      global: z.boolean().optional().describe("Install globally (default: false)"),
      approvalToken: z
        .string()
        .optional()
        .describe(
          "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
        ),
      approvalInterviewId: z.string().optional().describe("AskUser interview ID for approval."),
      sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
      taskRunId: z.string().optional().describe("Alternate session identity."),
    },
  },
  async ({
    packages,
    dev,
    global,
    approvalToken,
    approvalInterviewId,
    sessionId,
    taskRunId,
  }: InstallPackagesToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      const gate = await approval.ensureApproved({
        action: "package_manager:install_packages",
        details: `Packages [${packages.join(", ")}] will be installed using ${detection.detected.manager}.`,
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: !gate.response.success,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response,
        };
      }

      const result = await installPackages(
        { packages, dev, global },
        detection.detected.manager,
        repoPath,
      );
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Install failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// update_packages
server.registerTool(
  "update_packages",
  {
    description:
      "Update packages to newer versions. Supports action execution for npm, pip, cargo, and go based on current implementation. Gradle may be detected but is not supported for this action in the current release.",
    inputSchema: {
      packages: z.array(z.string()).optional().describe("Specific packages to update"),
      all: z.boolean().optional().describe("Update all packages (default: false)"),
      check: z
        .boolean()
        .optional()
        .describe("Only check for updates without installing (default: false)"),
      approvalToken: z
        .string()
        .optional()
        .describe(
          "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
        ),
      approvalInterviewId: z.string().optional().describe("AskUser interview ID for approval."),
      sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
      taskRunId: z.string().optional().describe("Alternate session identity."),
    },
  },
  async ({
    packages,
    all,
    check,
    approvalToken,
    approvalInterviewId,
    sessionId,
    taskRunId,
  }: UpdatePackagesToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      const target = all ? "all packages" : `packages [${(packages ?? []).join(", ")}]`;
      const gate = await approval.ensureApproved({
        action: "package_manager:update_packages",
        details: `${target} will be updated using ${detection.detected.manager}.`,
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: !gate.response.success,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response,
        };
      }

      const result = await updatePackages(
        { packages, all, check },
        detection.detected.manager,
        repoPath,
      );
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Update failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// audit_vulnerabilities
server.registerTool(
  "audit_vulnerabilities",
  {
    description:
      "Audit dependencies for security vulnerabilities. Optionally fix vulnerabilities automatically.",
    inputSchema: {
      fix: z.boolean().optional().describe("Automatically fix vulnerabilities (default: false)"),
      severity: z
        .enum(["low", "moderate", "high", "critical"])
        .optional()
        .describe("Filter by severity level"),
      approvalToken: z
        .string()
        .optional()
        .describe(
          "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
        ),
      approvalInterviewId: z.string().optional().describe("AskUser interview ID for approval."),
      sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
      taskRunId: z.string().optional().describe("Alternate session identity."),
    },
  },
  async ({
    fix,
    severity,
    approvalToken,
    approvalInterviewId,
    sessionId,
    taskRunId,
  }: AuditVulnerabilitiesToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      if (fix) {
        const gate = await approval.ensureApproved({
          action: "package_manager:audit_vulnerabilities_fix",
          details: `Vulnerability fixes will be applied using ${detection.detected.manager}.`,
          approvalToken,
          approvalInterviewId,
          sessionId,
          taskRunId,
        });
        if (!gate.ok) {
          return {
            isError: !gate.response.success,
            content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
            structuredContent: gate.response,
          };
        }
      }

      const result = await auditVulnerabilities(
        { fix, severity },
        detection.detected.manager,
        repoPath,
      );
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Audit failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// list_outdated
server.registerTool(
  "list_outdated",
  {
    description: "List outdated packages with available updates.",
    inputSchema: {
      format: z
        .enum(["list", "json", "outdated"])
        .optional()
        .describe("Output format (default: list)"),
    },
  },
  async ({ format }: ListOutdatedToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      const result = await listOutdated({ format }, detection.detected.manager, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `List outdated failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// remove_dependencies
server.registerTool(
  "remove_dependencies",
  {
    description:
      "Remove packages from the project. Supports action execution for npm, pip, and cargo based on current implementation. Gradle may be detected but is not supported for this action in the current release.",
    inputSchema: {
      packages: z.array(z.string()).min(1).describe("Package names to remove"),
      approvalToken: z
        .string()
        .optional()
        .describe(
          "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
        ),
      approvalInterviewId: z.string().optional().describe("AskUser interview ID for approval."),
      sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
      taskRunId: z.string().optional().describe("Alternate session identity."),
    },
  },
  async ({
    packages,
    approvalToken,
    approvalInterviewId,
    sessionId,
    taskRunId,
  }: RemoveDependenciesToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      const gate = await approval.ensureApproved({
        action: "package_manager:remove_dependencies",
        details: `Packages [${packages.join(", ")}] will be removed using ${detection.detected.manager}.`,
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: !gate.response.success,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response,
        };
      }

      const result = await removeDependencies({ packages }, detection.detected.manager, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Remove failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// view_dependencies
server.registerTool(
  "view_dependencies",
  {
    description:
      "View project dependencies in a tree structure or list format. Supports filtering by depth and direct dependencies only.",
    inputSchema: {
      depth: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Tree depth to display (default: 0 = all)"),
      onlyDirect: z.boolean().optional().describe("Show only direct dependencies (default: false)"),
    },
  },
  async ({ depth, onlyDirect }: ViewDependenciesToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      const result = await viewDependencies(
        { depth, onlyDirect },
        detection.detected.manager,
        repoPath,
      );
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `View dependencies failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

// lock_dependencies
server.registerTool(
  "lock_dependencies",
  {
    description:
      "Lock or freeze dependencies to ensure reproducible builds. Supports frozen installs (ci) or updating lock files.",
    inputSchema: {
      frozen: z
        .boolean()
        .optional()
        .describe("Use frozen/ci mode for reproducible installs (default: true)"),
      approvalToken: z
        .string()
        .optional()
        .describe(
          "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
        ),
      approvalInterviewId: z.string().optional().describe("AskUser interview ID for approval."),
      sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
      taskRunId: z.string().optional().describe("Alternate session identity."),
    },
  },
  async ({
    frozen,
    approvalToken,
    approvalInterviewId,
    sessionId,
    taskRunId,
  }: LockDependenciesToolInput): Promise<CallToolResult> => {
    const repoPath = getPackageManagerWorkspaceRoot();
    try {
      const detection = await detectPackageManager(repoPath);
      if (!detection.detected) {
        return {
          isError: true,
          content: [{ type: "text", text: "No package manager detected" }],
        };
      }

      const gate = await approval.ensureApproved({
        action: "package_manager:lock_dependencies",
        details: `Dependency lock/frozen operation will run using ${detection.detected.manager}.`,
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: !gate.response.success,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response,
        };
      }

      const result = await lockDependencies({ frozen }, detection.detected.manager, repoPath);
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      return {
        isError: true,
        content: [{ type: "text", text: `Lock dependencies failed: ${getErrorMessage(error)}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PackageManager MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
