# CI/CD & Branch Protection Guide

## Overview

This document provides guidance for setting up CI/CD workflows and branch protection rules for the LLM Toolkit project.

## Quality Gates

All pull requests must pass the following quality gates before merging:

### 1. Biome: Format & Lint
```bash
npm run check:ci
```
- Validates code formatting
- Checks linting rules
- Organizes imports
- Duration: ~1-5 seconds

### 2. TypeScript: Type Safety
```bash
npm run type-check
```
- Verifies TypeScript compilation
- Ensures strict mode compliance
- No `any` types allowed
- Duration: ~5-10 seconds

### 3. Jest: Tests & Coverage
```bash
npm run test:ci
```
- Runs all unit and integration tests
- Requires minimum 80% code coverage
- Individual tools may require higher thresholds:
  - Terminal: 85%
  - Calculator: 90%
- Duration: ~30-60 seconds

### 4. Build: Compilation
```bash
npm run build
```
- Compiles all TypeScript packages
- Verifies dist/ artifacts are generated
- Checks MCP server binaries
- Duration: ~15-30 seconds

### 5. Startup Readiness
```bash
npm run startup:check:strict
```
- Validates all MCP binaries exist
- Checks environment configuration
- Verifies plugin registration is in sync (`verify:mcp-sync`)
- Duration: ~2-5 seconds

## Complete Verification

To run all quality gates locally before pushing:

```bash
npm run verify:all
```

This chains the release hardening gates:
- `verify:vnext-scope` → `check:ci` → `type-check` → `test:ci` → `build` → `startup:check`

**Expected duration**: 1-3 minutes depending on system performance

## vNext Scope Governance

To avoid confusion between intentional release features and unrelated drift:

- Keep [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md) as the source of truth for next-version scope.
- Require PR authors to complete [.github/pull_request_template.md](../.github/pull_request_template.md) and explicitly mark whether the PR changes vNext scope.
- If feature scope is added, require a matching update to [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md) in the same PR.
- CI now enforces this via `npm run verify:vnext-scope` on pull requests.

## Branch Protection Rules

### Recommended Settings for `main` Branch

Configure these settings in GitHub repository settings under **Settings → Branches → Branch protection rules**:

#### 1. Require Pull Request Reviews
- ✅ **Require a pull request before merging**
- ✅ **Require approvals**: 1 minimum
- ✅ **Dismiss stale pull request approvals when new commits are pushed**
- ⬜ **Require review from Code Owners** (optional if CODEOWNERS file exists)

#### 2. Require Status Checks
- ✅ **Require status checks to pass before merging**
- ✅ **Require branches to be up to date before merging**

**Required status checks** (must all pass):
- `vnext-scope` (vNext Scope Guard)
- `biome` (Biome: Format & Lint)
- `type-check` (TypeScript: Type Safety)
- `test` (Jest: Tests & Coverage)
- `build` (Build: Compile TypeScript)

**Recommended additional required checks**:
- `startup-check` (startup readiness validation)
- `verify-all` (aggregated quality gate job, if configured in CI)

#### 3. Additional Restrictions
- ✅ **Require conversation resolution before merging**
- ✅ **Require linear history** (enforces rebase or squash merging)
- ✅ **Do not allow bypassing the above settings** (applies to administrators)

#### 4. Optional but Recommended
- ⬜ **Require signed commits** (for enhanced security)
- ⬜ **Include administrators** (enforce rules for all users)

### Protection Rules for `develop` Branch (if using git-flow)

If you use a git-flow branching strategy:
- Same rules as `main` but with relaxed approval requirements
- Allow self-approval for faster iteration
- Still require all status checks to pass

## Pre-Push Hooks (Optional)

See [Pre-Push Hook Setup](./PRE_PUSH_HOOKS.md) for local quality gate enforcement.

## CI Optimization

### Caching Strategy

The CI workflow uses GitHub Actions' built-in npm caching:

```yaml
- uses: actions/setup-node@v3
  with:
    node-version: "20"
    cache: 'npm'  # Caches based on package-lock.json
```

**Benefits**:
- Reduces `npm ci` duration from ~30s to ~5s on cache hits
- Automatically invalidates cache when dependencies change
- Shared across all jobs in the workflow

### Job Parallelization

All quality gate jobs run in parallel:
```
biome ──┐
type   ──┤
test   ──┼──→ All must pass
build  ──┘
```

**Total duration**: ~60-90 seconds (vs. ~2-3 minutes if sequential)

## Troubleshooting

### Failed Status Checks

#### Biome Failures
```bash
# Auto-fix formatting issues
npm run check

# Preview what would change
npm run format:check
```

#### Type Check Failures
```bash
# Get detailed error output
npm run type-check

# Check specific workspace
npm run -w Terminal type-check
```

#### Test Failures
```bash
# Run tests with watch mode
npm run test:watch

# Run specific test file
npm test -- testing/evaluation/evaluation-harness.test.ts

# Debug coverage
npm run test:ci -- --verbose
```

#### Build Failures
```bash
# Clean and rebuild
npm run clean
npm run build

# Build specific workspace
npm run -w Terminal build
```

#### Startup Check Failures
```bash
# Basic check (no env validation)
npm run startup:check

# Strict mode (validates env vars)
npm run startup:check:strict

# Verify MCP sync
npm run verify:mcp-sync

# Verify tool registration
npm run verify-tools
```

### CI Cache Issues

If caching causes problems (e.g., stale dependencies):

1. **Clear GitHub Actions cache**:
   - Go to **Settings → Actions → Caches**
   - Delete relevant caches manually

2. **Force fresh install locally**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

## Release Workflow

See [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) for the complete release process.

## CI Artifacts

The following artifacts are uploaded on each run:

- **Coverage reports**: `./ coverage/lcov-report/`
- **Build outputs**: Each tool's `dist/` directory
- **Evaluation results**: `testing/evaluation/results/`

Artifacts are retained for 90 days by default.

## Monitoring CI Health

### Key Metrics to Track
- **CI duration**: Target <2 minutes total
- **Cache hit rate**: Should be >80% on normal commits
- **Flaky tests**: Track in issues, should be <1% failure rate
- **Queue time**: Should be <30 seconds to start

### GitHub Actions Status Badge

Add to README.md:
```markdown
![CI](https://github.com/YOUR_USERNAME/llm-toolkit/actions/workflows/ci.yml/badge.svg)
```

## Next Steps

- Set up branch protection rules as described above
- Configure pre-push hooks for local enforcement
- Review [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines
- See [AGENT_ROADMAP.md](../AGENT_ROADMAP.md) for feature development roadmap
