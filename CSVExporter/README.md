# CSV Exporter Tool

Exports parsed table data into clean CSV files for spreadsheet workflows.

## Features

- MCP stdio server: dist/mcp-server.js
- HTTP server: dist/index.js
- Writes to user Documents folder by default
- Optional subfolder under Documents
- Appends rows to existing CSV by default
- Escapes commas, quotes, and newlines for spreadsheet compatibility

## Build

```bash
npm run build
```

## LM Studio Integration

CSVExporter is one of the 16 registered plugin entries. The toolkit uses a plugin-only configuration model — this server is provisioned automatically by `npm run mcp:sync-lmstudio`; no manual configuration is required.

Environment variables (set via the unified `llm-toolkit.config.yaml`):
- `CSV_EXPORT_ROOT` — directory CSV files are written to (empty = workspace default)

## MCP Tool

Tool name: save_parsed_data_csv

Input:
- filename (optional)
- subfolder (optional, relative to Documents)
- headers (required)
- rows (required)
- append (optional, defaults to true)

Output:
- success flag
- outputPath
- rowsWritten
- appended and createdNewFile indicators
