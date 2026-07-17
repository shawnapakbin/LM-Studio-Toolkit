# 3DTool MCP Server

**Version**: 2.3.0  
**Status**: Complete ✅  
**Branch**: `2.3.x`

A Model Context Protocol (MCP) server providing a browser-based Three.js 3D model viewer and editor. Supports OBJ and glTF/GLB formats with scene composition, PBR materials, structured validation, enriched annotations, and undo/redo history.

## Quick Start

```bash
# Build
cd 3DTool
npm run build

# The server runs via MCP stdio transport (launched by your MCP client)
node dist/mcp-server.js
```

The server is registered in `.kiro/settings/mcp.json` and auto-available to LLM clients in this workspace.

## Architecture

```
3DTool/
├── src/
│   ├── mcp-server.ts          # MCP entry point (stdio transport, 13 tool registrations)
│   ├── http-server.ts         # Express server (port 3344) — viewer assets, SSE, API
│   ├── scene-manager.ts       # Scene state: objects, materials, interactions, SSE clients
│   ├── file-editor.ts         # File write with validation + history backup
│   ├── obj-validator.ts       # OBJ structural validation (faces, syntax, orphans)
│   ├── metadata-extractor.ts  # Extract metadata from OBJ/GLB/glTF files
│   ├── history-manager.ts     # Timestamped backups in .history/ directory
│   ├── text-utils.ts          # Text truncation utilities
│   ├── shared-state.ts        # Singleton SceneManager instance
│   ├── types.ts               # Core type definitions + detectFormat utility
│   └── tools/                 # Individual tool handler modules
│       ├── launch-viewer.ts
│       ├── edit-3d-file.ts
│       ├── get-model-metadata.ts
│       ├── poll-interactions.ts
│       ├── add-object.ts
│       ├── remove-object.ts
│       ├── transform-object.ts
│       ├── list-objects.ts
│       ├── set-material.ts
│       ├── list-materials.ts
│       ├── list-history.ts
│       ├── rollback.ts
│       └── acknowledge-interaction.ts
├── dist/
│   ├── viewer/                # Three.js viewer (HTML/JS, served at localhost:3344)
│   └── *.js, *.d.ts, *.js.map
├── tests/
│   ├── unit/                  # Unit tests (OBJ validator, metadata, history, format)
│   ├── property/              # Property-based tests (fast-check)
│   └── integration/          # HTTP API integration tests
├── package.json
├── tsconfig.json
└── jest.config.js
```

## MCP Tools (13)

| Tool | Description |
|------|-------------|
| `launch_viewer` | Open the 3D viewer in the browser with a model file |
| `edit_3d_file` | Write model content (OBJ text or GLB base64) with validation and backup |
| `get_model_metadata` | Extract structured metadata (vertices, faces, meshes, materials, animations) |
| `poll_interactions` | Retrieve pending user annotations with enriched spatial data |
| `add_object` | Add a model to the scene with position, rotation, and scale |
| `remove_object` | Remove a named object from the scene |
| `transform_object` | Update position, rotation, or scale of a scene object |
| `list_objects` | List all objects in the scene with their transforms |
| `set_material` | Apply PBR material properties (color, roughness, metalness, emissive) |
| `list_materials` | List all materials in the scene |
| `list_history` | List up to 50 backup entries for the current model |
| `rollback` | Restore a model from a previous backup |
| `acknowledge_interaction` | Mark an annotation as resolved (transitions pin state in viewer) |

## Supported Formats

- **OBJ** — Wavefront OBJ text format (vertices, faces, normals, groups, materials)
- **GLB** — Binary glTF 2.0 (meshes, PBR materials, textures, animations)
- **glTF** — JSON glTF 2.0 with external resources

## Key Features

### Structured OBJ Validation
When writing OBJ files via `edit_3d_file`, the server validates:
- Face indices referencing valid vertices
- OBJ keyword syntax (v, vt, vn, f, g, o, s, usemtl, mtllib)
- Orphan vertices (warning)
- Inconsistent face winding (warning)

Returns a `ValidationReport` with line numbers and severity levels.

### Scene Management
Compose multi-object scenes with independent transforms. Objects can be added, removed, and transformed. The viewer updates via SSE within 2 seconds.

### Enriched Annotations
User annotations (Shift+Click in viewer) include:
- 3D position (x, y, z)
- Face normal (unit vector)
- Face index (zero-based)
- Object path (slash-separated ancestor chain)
- Target object identifier
- User prompt text

### Undo/Redo History
Every edit creates a timestamped backup in `.history/`. Use `list_history` to browse and `rollback` to restore any previous state.

### Viewer UX
- Onboarding overlay explaining Shift+Click workflow
- Model info panel (filename, vertex count, face count)
- Dark/light theme toggle
- Annotation pin labels with pending/resolved/stale states
- Toast notifications on model reload
- Camera and pin preservation across reloads

## Development

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode compilation
npm run test       # Run unit + property + integration tests
npm run clean      # Remove compiled output (preserves dist/viewer/)
```

## Testing

Tests use Jest with fast-check for property-based testing:

- **Unit tests**: OBJ validator, metadata extractor, history manager, format detection
- **Property tests**: Format routing, OBJ validation invariants, scene consistency, material validation, history ordering, text truncation, interaction enrichment
- **Integration tests**: HTTP API endpoints and SSE event delivery

```bash
npm run test
```

## HTTP Server Endpoints

The Express server runs on port 3344:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves the Three.js viewer |
| `/api/stream` | GET | SSE event stream (reload, pin_state, scene_update) |
| `/api/interactions` | POST | Submit annotation from viewer |
| `/api/scene` | GET | Current scene state (objects, materials) |
| `/api/load` | POST | Set active model file |
| `/api/reload` | POST | Trigger viewer reload |
| `/health` | GET | Health check |

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `express` — HTTP server
- `@gltf-transform/core` — glTF/GLB parsing for metadata extraction
- `zod` — Input validation schemas

## License

Non-Commercial License — See root LICENSE file.
