# FileEditor

Safe file system operations for LLM software engineer agents.

## Features

- **read_file** - Read file contents with optional line ranges
- **write_file** - Write/append to files with automatic backups
- **search_files** - Search for text patterns across files
- **list_directory** - List directory contents (recursive support)
- **delete_file** - Delete files with optional backup
- **move_file** - Move/rename files

## Safety Features

✅ **Workspace sandboxing** - All operations confined to workspace root  
✅ **Path traversal prevention** - Blocks `../` and escape attempts  
✅ **Sensitive file protection** - Blocks system files, credentials, etc.  
✅ **Content safety checks** - Detects dangerous code patterns  
✅ **Automatic backups** - Create backups before destructive operations  
✅ **File size limits** - Max 10MB per file

## Configuration

```bash
# Optional: Set workspace root (defaults to current directory)
export FILE_EDITOR_WORKSPACE_ROOT="$(pwd)"

# Optional: HTTP server port (defaults to 3010)
export PORT=3010
```

## Usage

### HTTP API

```bash
# Start server
npm start

# Read file
curl -X POST http://localhost:3010/tools/read_file \
  -H "Content-Type: application/json" \
  -d '{"path": "README.md", "startLine": 1, "endLine": 10}'

# Write file
curl -X POST http://localhost:3010/tools/write_file \
  -H "Content-Type: application/json" \
  -d '{"path": "test.txt", "content": "Hello World", "createBackup": true}'

# Search files
curl -X POST http://localhost:3010/tools/search_files \
  -H "Content-Type: application/json" \
  -d '{"pattern": "import", "fileExtensions": [".ts", ".js"], "maxResults": 20}'
```

### MCP Server

FileEditor is a registered runtime MCP server — one of the 16 registered plugin entries. The toolkit uses a plugin-only configuration model, so this server is provisioned automatically by `npm run mcp:sync-lmstudio`; no manual configuration is required.

Environment variables (set via the unified `llm-toolkit.config.yaml`):
- `FILE_EDITOR_WORKSPACE_ROOT` — workspace sandbox root the tool is confined to (default `.`)

## Tool Schemas

### read_file
```typescript
{
  path: string;          // File path relative to workspace
  startLine?: number;    // Start line (1-indexed, optional)
  endLine?: number;      // End line (1-indexed, optional)
}
```

### write_file
```typescript
{
  path: string;          // File path relative to workspace
  content: string;       // File content
  createBackup?: boolean; // Create backup before writing (default: false)
  mode?: "overwrite" | "append"; // Write mode (default: "overwrite")
}
```

### search_files
```typescript
{
  pattern: string;       // Text pattern to search for
  directory?: string;    // Directory to search in (default: workspace root)
  fileExtensions?: string[]; // Filter by extensions (e.g., [".ts", ".js"])
  maxResults?: number;   // Max results to return (default: 50)
  caseSensitive?: boolean; // Case-sensitive search (default: false)
}
```

### list_directory
```typescript
{
  path: string;          // Directory path relative to workspace
  recursive?: boolean;   // List subdirectories recursively (default: false)
  includeHidden?: boolean; // Include hidden files (default: false)
}
```

### delete_file
```typescript
{
  path: string;          // File path relative to workspace
  createBackup?: boolean; // Create backup before deleting (default: true)
}
```

### move_file
```typescript
{
  source: string;        // Source file path
  destination: string;   // Destination file path
  overwrite?: boolean;   // Overwrite if destination exists (default: false)
}
```

## Security Policies

### Blocked Paths
- System files (`/etc/passwd`, `/etc/shadow`, Windows system32)
- Credentials (`~/.ssh/`, `.aws/credentials`, `.gnupg/`)
- Database lock files (`*.db-wal`, `*.sqlite-shm`)

### Blocked Extensions for Writing
- Executables: `.exe`, `.dll`, `.so`, `.dylib`, `.bin`
- Installers: `.msi`, `.dmg`, `.pkg`, `.deb`, `.rpm`
- Scripts: `.bat`, `.cmd`, `.com`, `.scr`

### Protected Files (Cannot Delete)
- `package.json`, `package-lock.json`
- `tsconfig.json`, `.gitignore`
- `.env`, `Dockerfile`

## Development

```bash
npm run dev       # Start HTTP server with hot reload
npm run dev:mcp   # Start MCP server with hot reload
npm run build     # Compile TypeScript
npm test          # Run tests
```

## Architecture

FileEditor follows the dual-server pattern with shared handler logic:

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
         │ file-editor │
         │   policy    │
         └─────────────┘
```

## Error Handling

All operations return standardized error responses:

```typescript
{
  success: false,
  errorCode: "INVALID_INPUT" | "POLICY_BLOCKED" | "EXECUTION_FAILED" | "TIMEOUT",
  errorMessage: string,
  timingMs: number,
  traceId: string
}
```

## Best Practices

1. **Always use relative paths** within the workspace
2. **Enable backups** for destructive operations (write, delete)
3. **Use line ranges** when reading large files
4. **Filter by extension** when searching to improve performance
5. **Check error codes** to handle policy violations appropriately

## Limitations

- Maximum file size: 10MB
- Backup directory: `.file-editor-backups/` (created automatically)
- Binary file operations not supported (read/write are text-only)
- No symbolic link following (for security)

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
