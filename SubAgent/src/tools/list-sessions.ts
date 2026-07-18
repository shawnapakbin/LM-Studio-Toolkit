/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import type { ServerConfig } from "../mcp-server";
import { type RegistryFilter, SessionRegistry } from "../session-registry";

/**
 * Module-level reference to the shared SessionRegistry singleton.
 * Set via `setSessionRegistry()` during server initialization,
 * or lazily created on first access.
 */
let registryInstance: SessionRegistry | null = null;

/**
 * Configure the SessionRegistry instance used by this handler.
 * Called during server startup to wire the shared singleton.
 */
export function setSessionRegistry(registry: SessionRegistry): void {
  registryInstance = registry;
}

/**
 * Returns the configured SessionRegistry, creating a new one if not yet initialized.
 */
function getRegistry(): SessionRegistry {
  if (!registryInstance) {
    registryInstance = new SessionRegistry();
  }
  return registryInstance;
}

/**
 * Handler for the list_sessions MCP tool.
 * Query the session registry for dispatched sub-sessions with optional filters.
 *
 * Accepts optional filters:
 * - status: filter by session status (exact match)
 * - dispatchId: filter by dispatch identifier (exact match)
 * - hashPrefix: filter by input hash prefix (1–64 chars, startsWith match)
 *
 * Filters are applied as logical AND when multiple are provided.
 * Returns entries ordered by timestamp ascending when no filters provided.
 */
export async function handleListSessions(
  args: unknown,
  _config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const parsed = args as { status?: string; dispatchId?: string; hashPrefix?: string };

  // Validate hashPrefix length if provided
  if (parsed?.hashPrefix !== undefined) {
    if (
      typeof parsed.hashPrefix !== "string" ||
      parsed.hashPrefix.length < 1 ||
      parsed.hashPrefix.length > 64
    ) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Invalid hashPrefix: must be a string between 1 and 64 characters.",
            }),
          },
        ],
      };
    }
  }

  // Build the filter object from provided arguments
  const filter: RegistryFilter = {};
  if (parsed?.status !== undefined && typeof parsed.status === "string") {
    filter.status = parsed.status;
  }
  if (parsed?.dispatchId !== undefined && typeof parsed.dispatchId === "string") {
    filter.dispatchId = parsed.dispatchId;
  }
  if (parsed?.hashPrefix !== undefined && typeof parsed.hashPrefix === "string") {
    filter.hashPrefix = parsed.hashPrefix;
  }

  const hasFilters =
    filter.status !== undefined ||
    filter.dispatchId !== undefined ||
    filter.hashPrefix !== undefined;
  const registry = getRegistry();
  const entries = registry.list(hasFilters ? filter : undefined);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          sessions: entries,
          count: entries.length,
        }),
      },
    ],
  };
}
