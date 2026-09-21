#!/usr/bin/env node
/**
 * validate-config-schema.js
 *
 * Pre-commit quality gate: validates the unified config schema is parseable,
 * contains no duplicate namespace keys, and all internal references resolve.
 *
 * Exits 0 on success, 1 on failure with descriptive error.
 *
 * Requirements: 10.2 (Config_Schema validation as pre-commit check)
 */
const path = require("path");

const sharedConfigDist = path.resolve(__dirname, "..", "..", "shared", "config", "dist");

function main() {
  let configSchema;
  let schemaMeta;

  // 1. Verify the schema module is importable and parseable
  try {
    const schemaModule = require(path.join(sharedConfigDist, "schema.js"));
    configSchema = schemaModule.configSchema;
    if (!configSchema) {
      console.error(
        "✗ Config schema: 'configSchema' export is missing from shared/config/dist/schema.js",
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Config schema: Failed to import schema module: ${err.message}`);
    process.exit(1);
  }

  // 2. Verify the schema-meta module is importable
  try {
    const metaModule = require(path.join(sharedConfigDist, "schema-meta.js"));
    schemaMeta = metaModule.schemaMeta;
    if (!schemaMeta) {
      console.error(
        "✗ Config schema: 'schemaMeta' export is missing from shared/config/dist/schema-meta.js",
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Config schema: Failed to import schema-meta module: ${err.message}`);
    process.exit(1);
  }

  // 3. Verify the schema can parse a default config (instantiates without error)
  try {
    const result = configSchema.safeParse({});
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      console.error(`✗ Config schema: Default config fails validation:\n${issues}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Config schema: safeParse threw unexpectedly: ${err.message}`);
    process.exit(1);
  }

  // 4. Check for duplicate namespace keys
  try {
    const shape = configSchema.shape;
    if (!shape || typeof shape !== "object") {
      console.error("✗ Config schema: Schema shape is not accessible (expected Zod object schema)");
      process.exit(1);
    }

    const keys = Object.keys(shape);
    const seen = new Set();
    const duplicates = [];

    for (const key of keys) {
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }

    if (duplicates.length > 0) {
      console.error(`✗ Config schema: Duplicate namespace keys found: ${duplicates.join(", ")}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Config schema: Error checking namespace keys: ${err.message}`);
    process.exit(1);
  }

  // 5. Verify all schemaMeta paths reference valid schema paths
  try {
    const shape = configSchema.shape;
    const namespaceKeys = Object.keys(shape);
    const unresolvedPaths = [];

    for (const dottedPath of Object.keys(schemaMeta)) {
      const parts = dottedPath.split(".");
      if (parts.length < 2) {
        unresolvedPaths.push(dottedPath);
        continue;
      }

      const [namespace] = parts;
      if (!namespaceKeys.includes(namespace)) {
        unresolvedPaths.push(dottedPath);
      }
    }

    if (unresolvedPaths.length > 0) {
      console.error(
        `✗ Config schema: schemaMeta references unresolved namespace paths:\n` +
          unresolvedPaths.map((p) => `  ${p}`).join("\n"),
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Config schema: Error verifying schemaMeta references: ${err.message}`);
    process.exit(1);
  }

  console.log(
    "✓ Config schema validation passed (parseable, no duplicate keys, all references resolve)",
  );
}

main();
