# 3DTool

An interactive 3D model editor MCP server for `llm-toolkit`.

## Features
- **Dual Interface**: Express HTTP server for rendering the web-based sandboxed 3D Viewer (`three.js`), and stdio-based MCP server for LLM integration.
- **Dynamic Workspaces**: Safely restricts file operations to user-approved boundary directories.
- **Interactive Viewport**: View models in standard formats (OBJ, etc.), shift-click to set visual annotation pins, and send spatial coordinates + text prompts directly back to the LLM agent via a polling queue.
- **Live Reload & Auto-Backups**: Agent edits via `.history/` snapshot backups and auto-reloading Server-Sent Events (SSE).

## Tools Exposed
- `launch_viewer`: Opens the 3D sandbox referencing a designated file and authorizes its workspace root.
- `poll_interactions`: Returns the queue of user spatial instructions (x,y,z, prompt, mesh).
- `get_model_metadata`: Reads internal structure (e.g., obj vertices, faces, groups) for LLM context without visual rendering.
- `edit_3d_file`: Accepts new string file content, creates a `.bak` backup, saves the mesh, and triggers Web-UI live reloads.

## Development
\`\`\`bash
npm run dev        # Run the Express UI server
npm run dev:mcp    # Run the MCP server
npm test           # Run Jest anti-regression tests
npm run build      # Compile the Typescript server
\`\`\`
