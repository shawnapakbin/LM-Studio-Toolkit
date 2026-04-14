#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }

  return result.stdout || "";
}

function getStagedFiles() {
  const out = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getStagedContent(filePath) {
  const result = spawnSync("git", ["show", `:${filePath}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout || "";
}

function isLikelyBinary(content) {
  return content.includes("\u0000");
}

function isPlaceholder(value) {
  const v = value.toLowerCase();
  return ["your_", "example", "sample", "changeme", "placeholder", "test", "dummy"].some((x) =>
    v.includes(x),
  );
}

const lineAllowList = [
  /estimated_used_tokens/i,
  /summaryTokenCount/i,
  /token_count/i,
  /ECM_AUTO_COMPACT_SUMMARY_MAX_TOKENS/i,
  /ECM_MODEL_CONTEXT_LIMIT/i,
];

const checks = [
  {
    id: "private-key",
    regex: /-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/,
    message: "Private key material detected.",
  },
  {
    id: "aws-key",
    regex: /AKIA[0-9A-Z]{16}/,
    message: "AWS access key pattern detected.",
  },
  {
    id: "github-pat",
    regex: /(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})/,
    message: "GitHub token pattern detected.",
  },
  {
    id: "openai-key",
    regex: /sk-[A-Za-z0-9]{20,}/,
    message: "API key pattern detected (sk-*).",
  },
  {
    id: "bearer",
    regex: /bearer\s+[A-Za-z0-9._-]{20,}/i,
    message: "Bearer token pattern detected.",
  },
  {
    id: "generic-secret-assignment",
    regex:
      /(api[_-]?key|secret|token|password|passwd|client[_-]?secret)\s*[:=]\s*["']([^"'\n]{8,})["']/i,
    message: "Potential secret assignment detected.",
    validate: (line, match) => {
      const value = match && match[2] ? String(match[2]) : "";
      if (!value) return false;
      if (isPlaceholder(value)) return false;
      return true;
    },
  },
  {
    id: "absolute-local-path",
    regex: /(C:\\Users\\|\/Users\/|\/home\/[A-Za-z0-9._-]+\/)/,
    message: "Absolute local path detected.",
    validate: (line) => {
      const normalized = line.toLowerCase();
      if (
        normalized.includes("<you>") ||
        normalized.includes("<user>") ||
        normalized.includes("%userprofile%") ||
        normalized.includes("$home")
      ) {
        return false;
      }
      return true;
    },
  },
  {
    id: "personal-email",
    regex: /[A-Za-z0-9._%+-]+@(gmail\.com|outlook\.com|hotmail\.com|yahoo\.com)/i,
    message: "Personal email detected.",
  },
];

function main() {
  const files = getStagedFiles();
  if (files.length === 0) {
    process.exit(0);
  }

  const findings = [];

  for (const file of files) {
    const content = getStagedContent(file);
    if (!content || isLikelyBinary(content)) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (lineAllowList.some((re) => re.test(line))) {
        continue;
      }

      for (const check of checks) {
        const match = line.match(check.regex);
        if (!match) continue;

        if (typeof check.validate === "function" && !check.validate(line, match)) {
          continue;
        }

        findings.push({
          file,
          line: i + 1,
          check: check.id,
          message: check.message,
          snippet: line.trim().slice(0, 220),
        });
      }
    }
  }

  if (findings.length > 0) {
    console.error(
      "\nSecret/privacy scan failed. Potential sensitive data found in staged content:\n",
    );
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} [${finding.check}] ${finding.message}\n  ${finding.snippet}`,
      );
    }
    console.error("\nCommit blocked. Remove/redact sensitive values or unstage affected hunks.\n");
    process.exit(1);
  }

  console.log("[pre-commit] staged secret/privacy scan passed");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSecret/privacy scan failed to run: ${message}\n`);
  process.exit(1);
}
