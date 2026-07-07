/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

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
