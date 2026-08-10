/**
 * Configuration schema and Zod validation for LAN Sub Agent.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import { z } from "zod";
import type { EndpointDefinition } from "./types";

// ─── Strategy Type ───────────────────────────────────────────────────────────

export type LoadBalancerStrategy = "round-robin" | "least-connections" | "weighted";

// ─── Config Interface ────────────────────────────────────────────────────────

export interface LanSubAgentConfig {
  endpoints: EndpointDefinition[];
  loadBalancer: {
    strategy: LoadBalancerStrategy;
    retryLimit: number;
  };
  healthCheck: {
    intervalSeconds: number;
    timeoutMs: number;
    failureThreshold: number;
  };
  discovery: {
    enabled: boolean;
    intervalSeconds: number;
    broadcastPort: number;
    maxDiscovered: number;
  };
  localInstance: {
    host: string;
    port: number;
  };
  gui: {
    port: number;
    enabled: boolean;
  };
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const EndpointDefinitionSchema = z.object({
  id: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  models: z.array(z.string().min(1)).min(0).max(50),
  maxConcurrency: z.number().int().min(1).max(100),
  enabled: z.boolean(),
  source: z.enum(["manual", "discovered"]),
});

export const LoadBalancerConfigSchema = z.object({
  strategy: z.enum(["round-robin", "least-connections", "weighted"]),
  retryLimit: z.number().int().min(0).max(5).default(2),
});

export const HealthCheckConfigSchema = z.object({
  intervalSeconds: z.number().min(5).max(300).default(30),
  timeoutMs: z.number().int().min(1000).max(30000).default(5000),
  failureThreshold: z.number().int().min(1).max(10).default(2),
});

export const DiscoveryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().min(10).max(300).default(60),
  broadcastPort: z.number().int().min(1).max(65535).default(41234),
  maxDiscovered: z.number().int().min(1).max(200).default(50),
});

export const LocalInstanceConfigSchema = z.object({
  host: z.string().min(1).default("localhost"),
  port: z.number().int().min(1).max(65535).default(1234),
});

export const GuiConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(9847),
  enabled: z.boolean().default(true),
});

export const LanSubAgentConfigSchema = z.object({
  endpoints: z.array(EndpointDefinitionSchema).default([]),
  loadBalancer: LoadBalancerConfigSchema.default({ strategy: "round-robin", retryLimit: 2 }),
  healthCheck: HealthCheckConfigSchema.default({
    intervalSeconds: 30,
    timeoutMs: 5000,
    failureThreshold: 2,
  }),
  discovery: DiscoveryConfigSchema.default({
    enabled: true,
    intervalSeconds: 60,
    broadcastPort: 41234,
    maxDiscovered: 50,
  }),
  localInstance: LocalInstanceConfigSchema.default({ host: "localhost", port: 1234 }),
  gui: GuiConfigSchema.default({ port: 9847, enabled: true }),
});

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: LanSubAgentConfig = {
  endpoints: [],
  loadBalancer: { strategy: "round-robin", retryLimit: 2 },
  healthCheck: { intervalSeconds: 30, timeoutMs: 5000, failureThreshold: 2 },
  discovery: { enabled: true, intervalSeconds: 60, broadcastPort: 41234, maxDiscovered: 50 },
  localInstance: { host: "localhost", port: 1234 },
  gui: { port: 9847, enabled: true },
};
