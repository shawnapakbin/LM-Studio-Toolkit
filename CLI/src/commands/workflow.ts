/**
 * workflow — execute AgentRunner workflows from JSON files
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { createAgentRunner } from "../../../AgentRunner/src/index";
import type { Workflow } from "../../../AgentRunner/src/runner";
import { handleError } from "../http";

export function registerWorkflowCommands(program: Command): void {
  const workflow = program
    .command("workflow")
    .description("Execute and manage AgentRunner workflows");

  workflow
    .command("run <file>")
    .description("Execute a workflow from a JSON file")
    .option("-s, --session <id>", "Session ID for scoped execution")
    .option("--auto-approve", "Auto-approve approval-gated write steps")
    .option("--timeout <ms>", "Override global workflow timeout in ms", parseInt)
    .action(
      async (file: string, opts: { session?: string; autoApprove?: boolean; timeout?: number }) => {
        // Resolve file path
        const filePath = path.resolve(process.cwd(), file);
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File not found: ${filePath}`);
          process.exit(1);
        }

        // Parse workflow JSON
        let workflowDef: Workflow;
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          workflowDef = JSON.parse(raw) as Workflow;
        } catch (err) {
          console.error(
            `Error: Failed to parse workflow JSON — ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }

        // Apply timeout override if provided
        if (opts.timeout !== undefined) {
          workflowDef = { ...workflowDef, timeoutMs: opts.timeout };
        }

        console.log(`Running workflow: ${workflowDef.name || workflowDef.id}`);
        console.log(`  Mode: ${workflowDef.mode}`);
        console.log(`  Steps: ${workflowDef.steps.length}`);
        if (opts.session) console.log(`  Session: ${opts.session}`);
        console.log();

        try {
          const { runner, memory } = createAgentRunner({ autoRegisterTools: true });

          const result = await runner.executeWorkflow(workflowDef, {
            sessionId: opts.session,
            autoApproveWrites: opts.autoApprove ?? false,
            autoGenerateApprovalFollowUp: true,
          });

          // Persist run to memory store
          try {
            memory.storeRun(workflowDef, result);
          } catch {
            // Non-fatal — memory persistence failure shouldn't fail the command
          }

          // Print step results
          for (const step of result.steps) {
            const icon = step.success ? "✓" : "✗";
            const duration = `${step.durationMs}ms`;
            const retries = step.retries > 0 ? ` (${step.retries} retries)` : "";
            console.log(`  ${icon} ${step.stepId} [${step.toolId}] — ${duration}${retries}`);
            if (!step.success && step.errorMessage) {
              console.log(`    Error: ${step.errorMessage}`);
            }
          }

          console.log();
          console.log(
            `Workflow ${result.success ? "completed successfully" : "failed"} in ${result.durationMs}ms`,
          );

          if (result.autoApproved) {
            console.log("  (auto-approved one or more blocked write steps)");
          }

          if (result.followUpWorkflow) {
            console.log("\nApproval required. Follow-up workflow generated:");
            console.log(`  ID: ${result.followUpWorkflow.id}`);
            console.log("  Run the follow-up workflow after approval to continue.");
          }

          if (!result.success) {
            process.exit(1);
          }
        } catch (err) {
          handleError(err);
        }
      },
    );
}
