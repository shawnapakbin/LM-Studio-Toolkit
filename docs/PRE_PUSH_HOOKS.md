# Pre-Push Hook Setup

## Overview

Pre-push hooks automatically run quality gates before code is pushed to the remote repository, catching issues early and reducing CI failures.

## Pre-Commit Hooks (Active)

The project uses **Husky** + **lint-staged** for pre-commit checks. These are installed automatically when you run `npm install` (via the `prepare` script).

**What runs on every commit:**
- `biome check --diagnostic-level=error --no-errors-on-unmatched` on all staged `*.{ts,js,json}` files

**Configuration:**
- Husky: `.husky/pre-commit`
- lint-staged: `lint-staged` key in root `package.json`

## Pre-Push Hooks (Optional)

## Benefits

- ✅ **Catch issues locally** before CI runs
- ✅ **Faster feedback** than waiting for CI
- ✅ **Reduce CI usage** and queue time
- ✅ **Prevent broken builds** on shared branches
- ✅ **Save time** by avoiding push → failed CI → fix → push cycles

## Installation

### Option 1: Manual Git Hook (Recommended)

Create the hook file manually for full control:

```bash
# Create the pre-push hook
cat > .git/hooks/pre-push << 'EOF'
#!/bin/sh

# Pre-push hook for LLM Toolkit
# Runs quality gates before allowing push

echo "🔍 Running pre-push quality gates..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run command and check result
run_gate() {
    local name=$1
    local command=$2
    
    echo "${YELLOW}▶${NC} $name"
    if eval "$command"; then
        echo "${GREEN}✓${NC} $name passed"
        return 0
    else
        echo "${RED}✗${NC} $name failed"
        return 1
    fi
}

# Track overall status
FAILED=0

# Run quality gates
run_gate "Format & Lint" "npm run check:ci" || FAILED=1
run_gate "Type Check" "npm run type-check" || FAILED=1
run_gate "Tests" "npm run test:ci" || FAILED=1
run_gate "Build" "npm run build" || FAILED=1

# Check if any gate failed
if [ $FAILED -eq 1 ]; then
    echo ""
    echo "${RED}╔══════════════════════════════════════════╗${NC}"
    echo "${RED}║  ❌ Pre-push checks failed              ║${NC}"
    echo "${RED}║                                          ║${NC}"
    echo "${RED}║  Fix the issues above before pushing    ║${NC}"
    echo "${RED}║  Or use --no-verify to bypass (unsafe)  ║${NC}"
    echo "${RED}╚══════════════════════════════════════════╝${NC}"
    exit 1
fi

echo ""
echo "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo "${GREEN}║  ✅ All pre-push checks passed!         ║${NC}"
echo "${GREEN}║                                          ║${NC}"
echo "${GREEN}║  Safe to push to remote                 ║${NC}"
echo "${GREEN}╚══════════════════════════════════════════╝${NC}"

exit 0
EOF

# Make it executable
chmod +x .git/hooks/pre-push
```

### Option 2: Lightweight Version (Fast)

Skip tests and evaluation for faster pushes:

```bash
cat > .git/hooks/pre-push << 'EOF'
#!/bin/sh

echo "🔍 Running fast pre-push checks..."

npm run check:ci && \
npm run type-check && \
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Pre-push checks failed. Fix issues or use --no-verify to bypass."
    exit 1
fi

echo "✅ Fast checks passed!"
exit 0
EOF

chmod +x .git/hooks/pre-push
```

### Option 3: Comprehensive Version (Complete)

Run all quality gates including evaluation:

```bash
cat > .git/hooks/pre-push << 'EOF'
#!/bin/sh

echo "🔍 Running comprehensive pre-push validation..."

npm run verify:all

if [ $? -ne 0 ]; then
    echo "❌ Comprehensive validation failed."
    echo "   Run 'npm run verify:all' locally to diagnose."
    exit 1
fi

echo "✅ All quality gates passed!"
exit 0
EOF

chmod +x .git/hooks/pre-push
```

### Option 4: Using Husky (Package-based)

If you prefer a package-managed approach:

```bash
# Install husky
npm install --save-dev husky

# Initialize husky
npx husky init

# Create pre-push hook
echo "npm run check:ci && npm run type-check && npm run test:ci && npm run build" > .husky/pre-push

# Make executable
chmod +x .husky/pre-push
```

## Verification

Test the hook is working:

```bash
# Make a trivial change
echo "// test" >> README.md

# Try to push (hook should run)
git add README.md
git commit -m "test: verify pre-push hook"
git push

# You should see the quality gates running
# If they pass, the push proceeds
# If they fail, the push is blocked
```

## Bypassing the Hook

### When to Bypass
- Emergency hotfix deployment
- Known non-critical failures
- WIP commits to feature branch
- CI-only validation needed

### How to Bypass

```bash
# Skip pre-push hook once
git push --no-verify

# Or
git push --force-with-lease --no-verify
```

**⚠️ Warning**: Use `--no-verify` sparingly. CI will still catch issues, but you'll wait longer for feedback.

## Customization

### Skip Specific Gates

Edit `.git/hooks/pre-push` to comment out gates you want to skip:

```bash
# run_gate "Tests" "npm run test:ci" || FAILED=1  # Skipped for speed
```

### Run Only on Main Branch

Add branch detection:

```bash
#!/bin/sh

# Get current branch
branch=$(git symbolic-ref HEAD | sed -e 's,.*/\(.*\),\1,')

# Only run on main/master
if [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
    echo "⚠️  Not on main branch, skipping pre-push checks"
    exit 0
fi

# ... rest of hook code
```

### Add Evaluation Check

Include the evaluation harness:

```bash
run_gate "Evaluation" "npm run eval:run" || FAILED=1
```

**Note**: This adds ~30-60 seconds to push time.

## Troubleshooting

### Hook Not Running

1. **Check if hook exists**:
   ```bash
   ls -la .git/hooks/pre-push
   ```

2. **Verify executable permission**:
   ```bash
   chmod +x .git/hooks/pre-push
   ```

3. **Test hook directly**:
   ```bash
   .git/hooks/pre-push
   echo $?  # Should be 0 for success, 1 for failure
   ```

### Hook Runs But Gates Fail

```bash
# Run gates manually to debug
npm run check:ci      # Format & lint
npm run type-check    # TypeScript
npm run test:ci       # Tests
npm run build         # Build
```

### Hook Too Slow

**Problem**: Hook takes 2-3 minutes, slowing down development.

**Solutions**:
1. Use the **Lightweight Version** (Option 2) - skip tests/eval
2. Add branch-specific logic (only run on main)
3. Use `--no-verify` for WIP commits on feature branches

### Windows-Specific Issues

If using Git Bash on Windows:

```bash
# Use explicit shell interpreter
#!/usr/bin/env bash
```

If using PowerShell:

```powershell
# Create .git/hooks/pre-push with .ps1 extension
# Git may not execute .ps1 directly - use wrapper script

# .git/hooks/pre-push (bash wrapper):
#!/bin/sh
powershell.exe -ExecutionPolicy Bypass -File .git/hooks/pre-push.ps1
```

## Comparison: Hook vs CI

| Aspect | Pre-Push Hook | GitHub Actions CI |
|--------|---------------|-------------------|
| **Speed** | ~1-3 min | ~1-3 min + queue |
| **Runs** | Every `git push` | Every commit & PR |
| **Environment** | Local machine | Cloud runner |
| **Bypassable** | Yes (`--no-verify`) | No (unless admin) |
| **Caching** | Local node_modules | GitHub cache (5s) |
| **Feedback** | Immediate | After push |
| **Cost** | Free | Free (public repos) |

**Recommendation**: Use both!
- **Hook** for fast local feedback
- **CI** as the enforced quality gate

## Team Setup

### Share Hook Configuration

Since `.git/hooks/` is not tracked by Git, share the hook via docs:

1. Add this document to the repository
2. Update CONTRIBUTING.md to reference it
3. Mention in onboarding README
4. Or use Husky to track hooks in `.husky/` (tracked by Git)

### Optional: Auto-Install Script

Create `scripts/install-hooks.sh`:

```bash
#!/bin/bash

echo "📦 Installing Git hooks..."

cp scripts/hooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push

echo "✅ Pre-push hook installed!"
echo "   Run 'git push' to test it"
```

Add to README:
```bash
# Install pre-push hook
npm run install-hooks
```

And package.json:
```json
{
  "scripts": {
    "install-hooks": "bash scripts/install-hooks.sh"
  }
}
```

## Advanced: Incremental Checks

Only check changed files for speed:

```bash
#!/bin/sh

# Get list of changed TypeScript files
changed_files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.ts$')

if [ -z "$changed_files" ]; then
    echo "No TypeScript files changed, skipping checks"
    exit 0
fi

# Run checks only on changed files
echo "Checking $changed_files"

# Type check only changed files (requires project references)
# npm run type-check -- $changed_files

# For now, run all checks (future optimization)
npm run check:ci && npm run type-check && npm run build
```

## References

- [Git Hooks Documentation](https://git-scm.com/docs/githooks)
- [Husky Documentation](https://typicode.github.io/husky/)
- [CICD.md](./CICD.md) - CI/CD and branch protection guide
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines

## Summary

✅ **Use Option 1 (Manual Hook)** for most developers
✅ **Use Option 2 (Lightweight)** for faster iteration
✅ **Use Option 4 (Husky)** for teams wanting version-controlled hooks
✅ Remember CI is the final gate, hooks are a developer convenience
✅ Use `--no-verify` judiciously for WIP/hotfix scenarios
