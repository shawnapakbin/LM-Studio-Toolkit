# PackageManager

Multi-ecosystem package management tool for Node.js, Python, Rust, Java, Go, and more.

## Supported Package Managers

| Manager | Detection | Install | Update | Audit | Outdated | Remove | List |
|---------|-----------|---------|--------|-------|----------|--------|------|
| **npm** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **pip** (Python) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **cargo** (Rust) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **maven** (Java) | ⚠️ | ✅ | ⚠️ | ✅ | ⚠️ | ❌ | ✅ |
| **gradle** (Java) | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **go mod** (Go) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |

## Features

- **Auto-detection** - Identifies which package manager is in use (npm, pip, cargo, etc.)
- **Multi-ecosystem** - Works across Node.js, Python, Rust, Java, Go projects
- **Installation** - Install single or multiple packages with dev/global options
- **Updates** - Check for updates or update packages to latest versions
- **Security audit** - Find and fix security vulnerabilities
- **Dependency management** - View, lock, and manage dependencies
- **Rate limiting** - Prevents abuse with configurable rate limits
- **Injection protection** - Validates package names and prevents command injection

## Configuration

```bash
# Optional: Set workspace root (defaults to current directory)
export PACKAGE_MANAGER_WORKSPACE_ROOT="$(pwd)"

# Optional: HTTP server port (defaults to 3012)
export PORT=3012
```

## Usage

### HTTP API

```bash
# Start server
npm start

# Detect package manager
curl -X POST http://localhost:3012/tools/detect_package_manager \
  -H "Content-Type: application/json" \
  -d '{}'

# Install packages
curl -X POST http://localhost:3012/tools/install_packages \
  -H "Content-Type: application/json" \
  -d '{"packages": ["express", "lodash"], "dev": false}'

# Update packages
curl -X POST http://localhost:3012/tools/update_packages \
  -H "Content-Type: application/json" \
  -d '{"all": true}'

# Audit for vulnerabilities
curl -X POST http://localhost:3012/tools/audit_vulnerabilities \
  -H "Content-Type: application/json" \
  -d '{"fix": true, "severity": "high"}'

# List outdated packages
curl -X POST http://localhost:3012/tools/list_outdated \
  -H "Content-Type: application/json" \
  -d '{"format": "json"}'
```

### MCP Server

PackageManager is one of the 16 registered plugin entries. The toolkit uses a plugin-only configuration model — this server is provisioned automatically by `npm run mcp:sync-lmstudio`; no manual configuration is required.

Environment variables (set via the unified `llm-toolkit.config.yaml`):
- `PACKAGE_MANAGER_WORKSPACE_ROOT` — project root the tool operates on (default `.`)

## Tool Schemas

### detect_package_manager
Auto-detect which package manager the project uses.

**Input:**
```typescript
{}
```

**Response:**
```typescript
{
  detected: {
    manager: "npm" | "pip" | "cargo" | "maven" | "gradle" | "go";
    version?: string;
    manifestFile: string;
    lockFile?: string;
  } | null;
  available: string[];  // List of all available package managers
}
```

### install_packages
Install one or more packages.

**Input:**
```typescript
{
  packages: string[];    // e.g., ["express", "lodash"]
  dev?: boolean;         // Install as dev dependency (npm only)
  global?: boolean;      // Install globally (npm only)
}
```

**Response:**
```typescript
{
  output: string;        // Installation output/logs
  installed: number;     // Count of packages installed
}
```

### update_packages
Update packages to newer versions.

**Input:**
```typescript
{
  packages?: string[];   // Specific packages to update (optional)
  all?: boolean;         // Update all packages
  check?: boolean;       // Only check without installing
}
```

**Response:**
```typescript
{
  output: string;        // Update output/logs
  updated: number;       // Count of packages updated
}
```

### audit_vulnerabilities
Find and fix security vulnerabilities.

**Input:**
```typescript
{
  fix?: boolean;         // Automatically fix vulnerabilities
  severity?: "low" | "moderate" | "high" | "critical";
}
```

**Response:**
```typescript
{
  output: string;        // Audit output/logs
  vulnerabilities: number; // Count of vulnerabilities found
}
```

### list_outdated
List packages with available updates.

**Input:**
```typescript
{
  format?: "list" | "json" | "outdated";  // Output format
}
```

**Response:**
```typescript
{
  output: string;        // Formatted list of outdated packages
  outdated: number;      // Count of outdated packages
}
```

### remove_dependencies
Remove packages from project.

**Input:**
```typescript
{
  packages: string[];    // Packages to remove
}
```

**Response:**
```typescript
{
  output: string;        // Removal output/logs
  removed: number;       // Count of packages removed
}
```

### view_dependencies
View project dependency tree or list.

**Input:**
```typescript
{
  depth?: number;        // Tree depth (0 = all)
  onlyDirect?: boolean;  // Show only direct dependencies
}
```

**Response:**
```typescript
{
  output: string;        // Formatted dependency tree/list
  dependencyCount: number; // Total dependencies
}
```

### lock_dependencies
Lock dependencies for reproducible builds.

**Input:**
```typescript
{
  frozen?: boolean;      // Use frozen/ci mode (default: true)
}
```

**Response:**
```typescript
{
  output: string;        // Lock operation output/logs
  locked: boolean;       // Whether dependencies are locked
}
```

## Security Policies

✅ **Package name validation** - Blocks suspicious patterns and command injection  
✅ **Injection protection** - Prevents shell metacharacters in package names  
✅ **Workspace sandboxing** - Operations confined to workspace root  
✅ **Rate limiting** - Max 10 operations per minute per operation type  
✅ **Registry validation** - Supports HTTPS and SSH registries  
✅ **Operation whitelisting** - Only allowed operations per package manager  

### Protected Package Patterns

Blocked:
- `rm -rf` - Command execution
- `__proto__` - Prototype pollution
- `eval` - Code injection
- `constructor` - Object manipulation
- Shell metacharacters: `;`, `|`, `&`, `` ` ``

## Best Practices

1. **Always detect first** - Run `detect_package_manager` to identify the package manager
2. **Audit before updating** - Run security audit before and after updates
3. **Lock in production** - Use `lock_dependencies` with frozen=true for CI/CD
4. **Check before updating** - Use update with check=true to preview changes
5. **Regular audits** - Run `audit_vulnerabilities` regularly to find issues
6. **Update gradually** - Update packages incrementally to catch breaking changes
7. **Version pinning** - Use lock files to ensure reproducible builds

## Common Workflows

### Check for Security Issues
```typescript
// 1. Detect package manager
detect_package_manager({})

// 2. Run security audit
audit_vulnerabilities({ fix: false, severity: "high" })

// 3. Auto-fix if needed
audit_vulnerabilities({ fix: true })
```

### Update All Dependencies
```typescript
// 1. Check what would be updated
update_packages({ check: true })

// 2. View changes
list_outdated({ format: "json" })

// 3. Update all packages
update_packages({ all: true })

// 4. Verify with audit
audit_vulnerabilities({ fix: true })
```

### Install New Package
```typescript
// 1. Install as regular dependency
install_packages({ packages: ["express"], dev: false })

// 2. Or as dev dependency
install_packages({ packages: ["jest"], dev: true })

// 3. Verify it was installed
view_dependencies({ onlyDirect: true })
```

### Cleanup Old Dependencies
```typescript
// 1. List all packages
view_dependencies({ onlyDirect: true })

// 2. Remove unused packages
remove_dependencies({ packages: ["old-package"] })

// 3. Verify removal
list_outdated({ format: "list" })
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
- `INVALID_INPUT` - Missing required packages, invalid package names
- `POLICY_BLOCKED` - Suspicious package name, rate limit exceeded, operation not supported
- `EXECUTION_FAILED` - Package manager not installed, network error, command failed

## Limitations

- No interactive prompts during installation
- Global installs limited (security risk)
- Maven/Gradle support is read-only for most operations
- Operations timeout after 60 seconds
- Maximum 10 operations per minute per operation type

## Development

```bash
npm run dev       # Start HTTP server with hot reload
npm run dev:mcp   # Start MCP server with hot reload
npm run build     # Compile TypeScript
npm test          # Run tests
```

## Architecture

PackageManager tool follows the dual-server pattern with shared handler logic:

```
┌─────────────┐      ┌─────────────┐
│ HTTP Server │      │ MCP Server  │
│ (Express)   │      │ (stdio)     │
└──────┬──────┘      └──────┬──────┘
       │                    │
       └────────┬───────────┘
                │
         ┌──────▼──────────┐
         │  Handlers       │
         │  package-       │
         │  manager.ts     │
         │  policy.ts      │
         └─────────────────┘
```

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
