/**
 * Lightweight HTTP helpers for tool invocation
 */

import fetch from "node-fetch";

export async function toolGet(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function toolPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as string) || (json.errorMessage as string) || res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return json;
}

export function printResult(data: unknown): void {
  if (typeof data === "object" && data !== null) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

export function handleError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
}
