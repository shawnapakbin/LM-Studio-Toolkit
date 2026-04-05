/**
 * HTTP dispatch helpers — post to a tool endpoint and return the result
 */

import fetch from "node-fetch";

export async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return json;
}

export async function get(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}
