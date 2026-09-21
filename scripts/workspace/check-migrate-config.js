#!/usr/bin/env node
/**
 * check-migrate-config.js
 *
 * Startup readiness check: verifies that migrate-config can produce a Config_File
 * from a sample .env that passes validation against the Config_Schema.
 *
 * Requirements: 10.4 (migrate-config in startup readiness check)
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const sharedConfigDist = path.resolve(__dirname, "..", "..", "shared", "config", "dist");

function main() {
  let migrateConfig;
  let configSchema;

  // 1. Verify migrate-config is importable
  try {
    const migrateModule = require(path.join(sharedConfigDist, "migrate.js"));
    migrateConfig = migrateModule.migrateConfig;
    if (typeof migrateConfig !== "function") {
      console.error("✗ migrate-config: 'migrateConfig' export is not a function");
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ migrate-config: Failed to import migrate module: ${err.message}`);
    process.exit(1);
  }

  // 2. Verify schema is importable
  try {
    const schemaModule = require(path.join(sharedConfigDist, "schema.js"));
    configSchema = schemaModule.configSchema;
    if (!configSchema) {
      console.error("✗ migrate-config: 'configSchema' export is missing");
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ migrate-config: Failed to import schema module: ${err.message}`);
    process.exit(1);
  }

  // 3. Create a temporary directory with a sample .env
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-config-check-"));
  const sampleEnvPath = path.join(tmpDir, ".env");
  const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");

  // Sample .env with a few representative keys that the schema recognizes
  const sampleEnv = [
    "# Sample .env for migrate-config readiness check",
    "TERMINAL_DEFAULT_TIMEOUT_MS=60000",
    "TERMINAL_MAX_TIMEOUT_MS=120000",
    "LOG_LEVEL=info",
  ].join("\n");

  try {
    fs.writeFileSync(sampleEnvPath, sampleEnv, "utf-8");

    // 4. Run migrateConfig - capture stderr but don't fail on warnings
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const stderrOutput = [];
    process.stderr.write = (chunk) => {
      stderrOutput.push(chunk.toString());
      return true;
    };

    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      migrateConfig({
        format: "yaml",
        envPath: sampleEnvPath,
        outputPath: outputPath,
      });
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    if (process.exitCode && process.exitCode !== 0) {
      console.error(`✗ migrate-config: Command exited with code ${process.exitCode}`);
      if (stderrOutput.length > 0) {
        console.error("  stderr:", stderrOutput.join(""));
      }
      process.exitCode = originalExitCode;
      process.exit(1);
    }
    process.exitCode = originalExitCode;

    // 5. Verify output file was created
    if (!fs.existsSync(outputPath)) {
      console.error("✗ migrate-config: Output config file was not created");
      process.exit(1);
    }

    // 6. Read and validate the output against the schema
    const yaml = require("yaml");
    let parsedConfig;
    try {
      const outputContent = fs.readFileSync(outputPath, "utf-8");
      parsedConfig = yaml.parse(outputContent);
    } catch (err) {
      console.error(`✗ migrate-config: Failed to parse generated config: ${err.message}`);
      process.exit(1);
    }

    // Remove 'custom' key before validation (not part of the schema)
    if (parsedConfig && typeof parsedConfig === "object") {
      delete parsedConfig.custom;
    }

    const result = configSchema.safeParse(parsedConfig);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      console.error(`✗ migrate-config: Generated config fails schema validation:\n${issues}`);
      process.exit(1);
    }

    console.log("✓ migrate-config readiness check passed");
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

main();
