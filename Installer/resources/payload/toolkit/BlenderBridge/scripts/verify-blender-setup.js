#!/usr/bin/env node

/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Blender MCP Setup Verification Script
 *
 * Attempts a TCP connection to the Blender MCP add-on socket to verify
 * the prerequisite chain is properly configured.
 *
 * Three possible outcomes:
 *   PASS     — Connection accepted, add-on is listening
 *   FAIL     — Connection refused, add-on not responding
 *   PARTIAL  — Connection timed out or could not complete
 *
 * Usage: node BlenderBridge/scripts/verify-blender-setup.js
 *   or:  npm run setup:blender
 *
 * Environment variables:
 *   BLENDER_MCP_HOST    — add-on host (default: 127.0.0.1)
 *   BLENDER_MCP_PORT    — add-on port (default: 9876)
 *   BLENDER_MCP_COMMAND — MCP server command (default: blender-mcp)
 */

const net = require("net");

const host = process.env.BLENDER_MCP_HOST || "127.0.0.1";
const port = parseInt(process.env.BLENDER_MCP_PORT || "9876", 10);
const command = process.env.BLENDER_MCP_COMMAND || "blender-mcp";
const TIMEOUT_MS = 3000;

function pass() {
  console.log("");
  console.log("\u2713 PASS \u2014 Blender MCP Setup Verified");
  console.log(`  Host: ${host}`);
  console.log(`  Port: ${port}`);
  console.log("  Addon: listening");
  console.log(`  Run: ${command}`);
  console.log("");
  process.exit(0);
}

function fail(reason) {
  console.log("");
  console.log("\u2717 FAIL \u2014 Blender MCP Setup Check Failed");
  console.log(`  Reason: ${reason}`);
  console.log("  The Blender add-on is not responding.");
  console.log(
    "  See BlenderBridge/README.md Troubleshooting section for resolution steps."
  );
  console.log("");
  process.exit(1);
}

function partial(reason) {
  console.log("");
  console.log("~ PARTIAL \u2014 Connection test incomplete or timed out");
  console.log(`  State: ${reason}`);
  console.log(`  Host: ${host}`);
  console.log(`  Port: ${port}`);
  console.log(
    "  See BlenderBridge/README.md Troubleshooting section for resolution steps."
  );
  console.log("");
  process.exit(1);
}

const socket = new net.Socket();

socket.setTimeout(TIMEOUT_MS);

socket.on("connect", () => {
  socket.destroy();
  pass();
});

socket.on("timeout", () => {
  socket.destroy();
  partial(
    `Connection timed out after ${TIMEOUT_MS / 1000}s on ${host}:${port} \u2014 add-on may not be reachable`
  );
});

socket.on("error", (err) => {
  socket.destroy();
  if (err.code === "ECONNREFUSED") {
    fail(`Connection refused on ${host}:${port}`);
  } else {
    fail(`${err.message} (${err.code || "unknown"}) on ${host}:${port}`);
  }
});

socket.connect(port, host);
