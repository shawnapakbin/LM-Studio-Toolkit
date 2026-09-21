# Git

Safe Git version control operations for LLM software engineer agents.

## Features

- **git_status** - View repository status and modified files
- **git_diff** - View changes between commits, branches, or working directory
- **git_log** - View commit history with filtering options
- **git_branch** - List, create, or delete branches
- **git_checkout** - Switch branches or restore files
- **git_commit** - Create commits with validation
- **git_push** - Push changes to remote (with force-push protection)
- **git_pull** - Pull changes from remote
- **git_clone** - Clone repositories (HTTPS/SSH only)
- **git_stash** - Stash, pop, list, or drop changes
- **git_reset** - Reset repository state (soft/mixed/hard)

## Safety Features

✅ **Protected branch guards** - Blocks force push/delete on main/master/production  
✅ **Commit message validation** - Enforces minimum quality standards  
✅ **Clone URL validation** - Blocks insecure protocols (file://, http://)  
✅ **Branch name validation** - Prevents invalid characters  
✅ **Hard reset warnings** - Explicit confirmation for destructive operations  
✅ **Repository validation** - Ensures .git directory exists

## Configuration

```bash
# Optional: Set workspace root (defaults to current directory)
export GIT_WORKSPACE_ROOT="$(pwd)"

# Optional: HTTP server port (defaults to 3011)
export PORT=3011
```

## Usage

### HTTP API

```bash
# Start server
npm start

# Get status
curl -X POST http://localhost:3011/tools/git_status \
  -H "Content-Type: application/json" \
  -d '{"short": true}'

# View diff
curl -X POST http://localhost:3011/tools/git_diff \
  -H "Content-Type: application/json" \
  -d '{"staged": true}'

# Commit changes
curl -X POST http://localhost:3011/tools/git_commit \
  -H "Content-Type: application/json" \
  -d '{"message": "feat: add new feature", "all": true}'

# Create and switch to new branch
curl -X POST http://localhost:3011/tools/git_checkout \
  -H "Content-Type: application/json" \
  -d '{"target": "feature/new-feature", "createBranch": true}'
```

### MCP Server

Git is one of the 16 registered plugin entries. The toolkit uses a plugin-only configuration model — this server is provisioned automatically by `npm run mcp:sync-lmstudio`; no manual configuration is required.

Environment variables (set via the unified `llm-toolkit.config.yaml`):
- `GIT_WORKSPACE_ROOT` — repository root the tool operates on (default `.`)

## Tool Schemas

### git_status
```typescript
{
  short?: boolean;  // Use short format (default: false)
}
```

Response:
```typescript
{
  output: string;   // Full git status output
  files: string[];  // Array of modified file paths
}
```

### git_diff
```typescript
{
  target?: string;  // Branch/commit to diff against
  staged?: boolean; // Show staged changes (default: false)
  file?: string;    // Limit diff to specific file
}
```

Response:
```typescript
{
  output: string;      // Full diff output
  filesChanged: number; // Count of files changed
}
```

### git_log
```typescript
{
  maxCount?: number;   // Max commits to show (default: 10)
  branch?: string;     // Branch to show log for
  file?: string;       // Show log for specific file
  oneline?: boolean;   // Use oneline format (default: false)
}
```

Response:
```typescript
{
  output: string;  // Full log output
  commits: Array<{
    hash: string;
    message: string;
  }>;
}
```

### git_branch
```typescript
{
  action: "list" | "create" | "delete";
  name?: string;     // Branch name (required for create/delete)
  force?: boolean;   // Force delete (default: false)
}
```

Response:
```typescript
{
  output: string;
  branches?: string[];  // List of branches (list action)
  current?: string;     // Current branch (list action)
}
```

### git_checkout
```typescript
{
  target: string;        // Branch name or commit hash
  createBranch?: boolean; // Create new branch (default: false)
}
```

Response:
```typescript
{
  output: string;
  branch: string;  // Current branch after checkout
}
```

### git_commit
```typescript
{
  message: string;   // Commit message (min 3 chars)
  all?: boolean;     // Stage all changes (git commit -a)
  amend?: boolean;   // Amend previous commit
}
```

Response:
```typescript
{
  output: string;
  hash: string;  // Commit hash
}
```

### git_push
```typescript
{
  remote?: string;      // Remote name (default: "origin")
  branch?: string;      // Branch to push
  force?: boolean;      // Force push (blocked for protected branches)
  setUpstream?: boolean; // Set upstream tracking
}
```

Response:
```typescript
{
  output: string;  // Push output
}
```

### git_pull
```typescript
{
  remote?: string;   // Remote name (default: "origin")
  branch?: string;   // Branch to pull
  rebase?: boolean;  // Use rebase instead of merge
}
```

Response:
```typescript
{
  output: string;  // Pull output
}
```

### git_clone
```typescript
{
  url: string;       // Repository URL (HTTPS/SSH only)
  directory?: string; // Target directory name
  branch?: string;   // Specific branch to clone
  depth?: number;    // Shallow clone depth
}
```

Response:
```typescript
{
  output: string;
  directory: string;  // Cloned directory path
}
```

### git_stash
```typescript
{
  action: "save" | "pop" | "list" | "drop";
  message?: string;  // Stash message (save action)
  index?: number;    // Stash index (pop/drop actions)
}
```

Response:
```typescript
{
  output: string;
  stashes?: Array<{  // Present for list action
    index: number;
    message: string;
  }>;
}
```

### git_reset
```typescript
{
  mode: "soft" | "mixed" | "hard";
  target?: string;  // Commit/branch to reset to (default: "HEAD")
}
```

Response:
```typescript
{
  output: string;  // Reset output
}
```

## Security Policies

### Protected Branches
These branches have additional safeguards:
- `main`, `master`, `production`, `prod`, `release`

**Restrictions**:
- ❌ Force push blocked
- ❌ Force delete blocked
- ⚠️  Amend commits warned (if already pushed)

### Clone URL Validation
- ✅ HTTPS URLs (`https://`)
- ✅ SSH URLs (`git@`)
- ❌ HTTP URLs (`http://`) - blocked (insecure)
- ❌ File URLs (`file://`) - blocked (security risk)

### Commit Message Rules
- Minimum 3 characters
- First line ≤100 characters (recommended ≤72)
- Blocks placeholder messages: `wip`, `todo`, `fixme`, `test`, `tmp`

### Branch Name Validation
- No spaces or special characters: `~^:?*[\]`
- Cannot start/end with `.`
- Cannot end with `.lock`

## Best Practices

1. **Always check status before commit**: `git_status` → review changes
2. **Use descriptive commit messages**: Follow conventional commits (feat:, fix:, docs:)
3. **Stash before switching branches**: Avoid losing uncommitted work
4. **Pull before push**: Reduce merge conflicts
5. **Avoid force operations**: Only use on feature branches, never on main
6. **Use short status for quick checks**: `{"short": true}`
7. **Shallow clone for large repos**: Use `depth: 1` for CI/testing

## Common Workflows

### Feature Branch Workflow
```typescript
// 1. Create feature branch
git_checkout({ target: "feature/new-feature", createBranch: true })

// 2. Make changes, check status
git_status({ short: true })

// 3. Review diff
git_diff({ staged: false })

// 4. Commit
git_commit({ message: "feat: implement new feature", all: true })

// 5. Push with upstream tracking
git_push({ branch: "feature/new-feature", setUpstream: true })
```

### Emergency Stash & Branch Switch
```typescript
// 1. Stash current work
git_stash({ action: "save", message: "WIP: feature X" })

// 2. Switch to hotfix branch
git_checkout({ target: "hotfix/critical-bug" })

// 3. Fix bug, commit, push...

// 4. Return and restore work
git_checkout({ target: "feature/original" })
git_stash({ action: "pop" })
```

### Review History
```typescript
// View recent commits
git_log({ maxCount: 20, oneline: true })

// View changes in specific file
git_log({ file: "src/index.ts", maxCount: 10 })

// View diff between branches
git_diff({ target: "main..feature/new" })
```

## Error Handling

All operations return standardized error responses:

```typescript
{
  success: false,
  errorCode: "INVALID_INPUT" | "POLICY_BLOCKED" | "EXECUTION_FAILED",
  errorMessage: string,
  timingMs: number,
  traceId: string
}
```

**Common Errors**:
- `INVALID_INPUT` - Missing required parameters, invalid Git repo
- `POLICY_BLOCKED` - Protected branch violation, insecure URL
- `EXECUTION_FAILED` - Git command failed (merge conflict, network error)

## Limitations

- Operations timeout after 30 seconds
- Maximum buffer size: 5MB (for large diffs/logs)
- Requires Git CLI installed on system
- No support for Git LFS operations
- No interactive operations (rebase -i, merge with conflicts)

## Development

```bash
npm run dev       # Start HTTP server with hot reload
npm run dev:mcp   # Start MCP server with hot reload
npm run build     # Compile TypeScript
npm test          # Run tests
```

## Architecture

Git tool follows the dual-server pattern with shared handler logic:

```
┌─────────────┐      ┌─────────────┐
│ HTTP Server │      │ MCP Server  │
│ (Express)   │      │ (stdio)     │
└──────┬──────┘      └──────┬──────┘
       │                    │
       └────────┬───────────┘
                │
         ┌──────▼──────┐
         │  Handlers   │
         │    git.ts   │
         │  policy.ts  │
         └─────────────┘
```

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
