/**
 * Discovery protocol message types and utilities for LAN Sub Agent.
 * Defines the UDP broadcast probe/response format used to discover
 * LM Studio instances on the local network.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

// ─── Protocol Message Types ──────────────────────────────────────────────────

export interface DiscoveryProbe {
  type: "lan-subagent-discover";
  version: 1;
}

export interface DiscoveryResponse {
  type: "lan-subagent-announce";
  version: 1;
  host: string;
  port: number;
  models: string[];
  maxConcurrency?: number;
}

// ─── Factory Functions ───────────────────────────────────────────────────────

/**
 * Create a discovery probe message ready for UDP broadcast.
 */
export function createDiscoveryProbe(): DiscoveryProbe {
  return {
    type: "lan-subagent-discover",
    version: 1,
  };
}

/**
 * Create a discovery response (announcement) message.
 */
export function createDiscoveryResponse(
  host: string,
  port: number,
  models: string[],
  maxConcurrency?: number,
): DiscoveryResponse {
  return {
    type: "lan-subagent-announce",
    version: 1,
    host,
    port,
    models,
    ...(maxConcurrency !== undefined && { maxConcurrency }),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate that a parsed message is a well-formed discovery probe.
 */
export function isValidProbe(msg: unknown): msg is DiscoveryProbe {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.type === "lan-subagent-discover" && obj.version === 1;
}

/**
 * Validate that a parsed message is a well-formed discovery response.
 * A valid response must have: type, version, non-empty host, port 1–65535,
 * and a non-empty models array of strings.
 */
export function isValidResponse(msg: unknown): msg is DiscoveryResponse {
  if (typeof msg !== "object" || msg === null) return false;
  const obj = msg as Record<string, unknown>;

  if (obj.type !== "lan-subagent-announce") return false;
  if (obj.version !== 1) return false;
  if (typeof obj.host !== "string" || obj.host.length === 0) return false;
  if (
    typeof obj.port !== "number" ||
    !Number.isInteger(obj.port) ||
    obj.port < 1 ||
    obj.port > 65535
  )
    return false;
  if (!Array.isArray(obj.models) || obj.models.length === 0) return false;
  if (!obj.models.every((m: unknown) => typeof m === "string" && m.length > 0)) return false;

  if (obj.maxConcurrency !== undefined) {
    if (
      typeof obj.maxConcurrency !== "number" ||
      !Number.isInteger(obj.maxConcurrency) ||
      obj.maxConcurrency < 1
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Attempt to parse a raw UDP buffer into a discovery probe or response.
 * Returns null if the buffer is not valid JSON or not a recognized message type.
 */
export function parseDiscoveryMessage(buffer: Buffer): DiscoveryProbe | DiscoveryResponse | null {
  try {
    const msg = JSON.parse(buffer.toString("utf-8"));
    if (isValidProbe(msg)) return msg;
    if (isValidResponse(msg)) return msg;
    return null;
  } catch {
    return null;
  }
}

/**
 * Serialize a discovery message to a Buffer for UDP transmission.
 */
export function serializeMessage(msg: DiscoveryProbe | DiscoveryResponse): Buffer {
  return Buffer.from(JSON.stringify(msg), "utf-8");
}
