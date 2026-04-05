import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

type CheckResult = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: string;
};

const checks: CheckResult[] = [];

function addCheck(
  name: string,
  status: "pass" | "warn" | "fail",
  message: string,
  details?: string,
): void {
  checks.push({ name, status, message, details });
}

const region = process.env.BROWSERLESS_DEFAULT_REGION;
const validRegions = ["production-sfo", "production-lon", "production-fra", "local"];
if (region && !validRegions.includes(region)) {
  addCheck(
    "Region",
    "warn",
    `Unknown region: ${region}`,
    `Valid regions: ${validRegions.join(", ")}. Will default to production-sfo if API call fails.`,
  );
} else if (!region) {
  addCheck(
    "Region",
    "pass",
    "Using default region: production-sfo",
    "Set BROWSERLESS_DEFAULT_REGION to override (production-sfo, production-lon, production-fra, local)",
  );
} else {
  addCheck(
    "Region",
    "pass",
    `Region configured: ${region}`,
    "Region selection affects latency and data residency",
  );
}

// Check 3: Timeout configuration
const timeoutStr = process.env.BROWSERLESS_DEFAULT_TIMEOUT_MS;
const DEFAULT_TIMEOUT_MS = 180000; // 3 minutes
const MIN_TIMEOUT_MS = 1000; // 1 second
const MAX_TIMEOUT_MS = 600000; // 10 minutes

if (timeoutStr) {
  const timeout = Number(timeoutStr);
  if (Number.isNaN(timeout)) {
    addCheck(
      "Timeout",
      "fail",
      `Invalid timeout value: ${timeoutStr}`,
      "Must be a number (milliseconds). Will use default 180000ms (3 minutes).",
    );
  } else if (timeout < MIN_TIMEOUT_MS) {
    addCheck(
      "Timeout",
      "warn",
      `Timeout too low: ${timeout}ms`,
      `Minimum recommended: ${MIN_TIMEOUT_MS}ms. Large pages may fail.`,
    );
  } else if (timeout > MAX_TIMEOUT_MS) {
    addCheck(
      "Timeout",
      "warn",
      `Timeout very high: ${timeout}ms`,
      `Maximum allowed: ${MAX_TIMEOUT_MS}ms. Consider reducing to prevent hung requests.`,
    );
  } else {
    addCheck(
      "Timeout",
      "pass",
      `Timeout configured: ${timeout}ms`,
      `Default timeout for all Browserless operations. Range: ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}ms.`,
    );
  }
} else {
  addCheck(
    "Timeout",
    "pass",
    `Using default timeout: ${DEFAULT_TIMEOUT_MS}ms`,
    "Set BROWSERLESS_DEFAULT_TIMEOUT_MS to override (milliseconds)",
  );
}

// Check 4: Concurrency limit
const concurrencyStr = process.env.BROWSERLESS_CONCURRENCY_LIMIT;
const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;

if (concurrencyStr) {
  const concurrency = Number(concurrencyStr);
  if (Number.isNaN(concurrency)) {
    addCheck(
      "Concurrency",
      "fail",
      `Invalid concurrency value: ${concurrencyStr}`,
      `Must be a number. Will use default ${DEFAULT_CONCURRENCY}.`,
    );
  } else if (concurrency < MIN_CONCURRENCY) {
    addCheck(
      "Concurrency",
      "warn",
      `Concurrency too low: ${concurrency}`,
      `Minimum: ${MIN_CONCURRENCY}. Setting too low will throttle all requests.`,
    );
  } else if (concurrency > MAX_CONCURRENCY) {
    addCheck(
      "Concurrency",
      "warn",
      `Concurrency very high: ${concurrency}`,
      `Maximum recommended: ${MAX_CONCURRENCY}. May exceed API quota limits.`,
    );
  } else {
    addCheck(
      "Concurrency",
      "pass",
      `Concurrency limit: ${concurrency}`,
      `Maximum ${concurrency} parallel requests. Prevents quota exhaustion.`,
    );
  }
} else {
  addCheck(
    "Concurrency",
    "pass",
    `Using default concurrency: ${DEFAULT_CONCURRENCY}`,
    "Set BROWSERLESS_CONCURRENCY_LIMIT to override (1-20 recommended)",
  );
}

// Check 5: Port configuration
const port = process.env.PORT;
if (port) {
  const portNum = Number(port);
  if (Number.isNaN(portNum)) {
    addCheck("Port", "warn", `Invalid PORT value: ${port}`, "Will use default 3003");
  } else if (portNum < 1024) {
    addCheck(
      "Port",
      "warn",
      `Privileged port: ${portNum}`,
      "Ports below 1024 require elevated permissions on Unix systems",
    );
  } else if (portNum > 65535) {
    addCheck("Port", "fail", `Invalid port number: ${portNum}`, "Port must be between 1 and 65535");
  } else {
    addCheck("Port", "pass", `Port configured: ${portNum}`, "HTTP server will listen on this port");
  }
} else {
  addCheck("Port", "pass", "Using default port: 3003", "Set PORT environment variable to override");
}

// Print results
console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       🔍 Browserless Environment Preflight Checks            ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log();

let hasFailures = false;
let hasWarnings = false;

for (const check of checks) {
  const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️ " : "❌";
  console.log(`${icon} ${check.name}: ${check.message}`);
  if (check.details) {
    console.log(`   ${check.details}`);
  }
  console.log();

  if (check.status === "fail") hasFailures = true;
  if (check.status === "warn") hasWarnings = true;
}

console.log("═══════════════════════════════════════════════════════════════");

if (hasFailures) {
  console.log("❌ PREFLIGHT FAILED: Critical issues detected");
  console.log("   Fix the errors above before starting Browserless tool");
  console.log();
  process.exit(1);
} else if (hasWarnings) {
  console.log("⚠️  PREFLIGHT PASSED WITH WARNINGS");
  console.log("   Review warnings above for optimal configuration");
  console.log();
  process.exit(0);
} else {
  console.log("✅ PREFLIGHT PASSED: All checks successful");
  console.log("   Browserless tool is ready to use");
  console.log();
  process.exit(0);
}
