# MANDATORY: Post-Edit Sync Rules

> Developed by: revDigit.link | Shawna Pakbin

You MUST follow these rules after every code change. Failure causes CI failures.

## TRIGGER CONDITIONS

Execute this checklist when ANY of these occur:
- A `package.json` is created, modified, or deleted
- A new workspace package is added to the root `workspaces` array
- Files are added that CI will lint, build, or test
- `shared/` or `shared/config/` are modified

## REQUIRED STEPS (execute in order)

### Step 1: Lock File Sync
```powershell
npm install
```
RULE: `package-lock.json` MUST be committed alongside any `package.json` change. CI uses `npm ci` which fails on any mismatch.

### Step 2: Committed State Verification
BEFORE running `npm install`, check: are there uncommitted changes in OTHER workspace `package.json` files?
- If YES: `git stash` those changes first, run `npm install`, then `git stash pop`
- If NO: proceed normally

REASON: `npm install` reads ALL workspace `package.json` files. Uncommitted local changes (e.g., renamed packages, version bumps in progress) produce a lock file that won't match CI's checkout.

### Step 3: Source File Completeness
If you added a workspace to the `workspaces` array, ALL of these must be committed:
- The workspace `package.json`
- All source files required for build (`src/`)
- `tsconfig.json`
- Test files (if referenced by CI test commands)

RULE: Never commit a workspace reference to an untracked directory.

### Step 4: Local CI Verification
```powershell
npm run check:ci     # Biome lint + format (entire repo)
npm run type-check   # TypeScript compilation
npm run build        # Full build (verifies shared/ outputs exist)
npm run test:ci      # Test suite matching CI
```
ALL four must pass before committing.

### Step 5: Stage Review
```powershell
git status
```
CHECK: Only intended files are staged. Watch for:
- Accidentally modified `package.json` files from other workspaces
- Lock file changes that include unrelated package drift
- Build artifacts (`dist/`) that should be gitignored

## CONSTRAINTS

### Secrets Scanner
Files in `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, or `fixtures/` paths are excluded from secret scanning.

For files OUTSIDE test paths, fake credentials must contain one of these substrings (case-insensitive): `test`, `example`, `dummy`, `placeholder`, `changeme`, `your_`, `sample`

### Biome Lint
- Do NOT use Jest `fail()` global — Biome flags it as undeclared. Use `throw new Error()` instead.
- Normalize line endings with `npx biome check --write <file>` if CRLF issues arise from `git checkout` on Windows.

### Workspace Resolution
- `npm ci` on CI fails immediately if ANY entry in `workspaces` array points to a directory without a valid `package.json`
- Workspace package names in the lock file must match the `name` field in the committed `package.json` — not a local uncommitted rename

## ERROR PATTERNS → FIXES

| CI Error | Root Cause | Fix |
|----------|-----------|-----|
| `No workspaces found: --workspace=X` | Workspace dir not committed or `package.json` missing | Commit the workspace package |
| `Missing: pkg@version from lock file` | Lock file generated with wrong local state | Stash local WIP, delete lock, `npm install --package-lock-only --ignore-scripts`, restore |
| `npm ci can only install packages when in sync` | Lock file doesn't match committed `package.json` | Run `npm install` and commit the updated lock |
| `noUndeclaredVariables: fail` | Used Jest `fail()` global | Replace with `throw new Error(msg)` |
| Biome format error on `package.json` | CRLF line endings from git checkout on Windows | `npx biome check --write <file>` |
