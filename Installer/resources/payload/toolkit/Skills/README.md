# Skills Tool (v2.1.0)

Persistent, reusable skill/playbook system for LLM agents. Define named skills with parameterized step templates, then execute them by name to get fully resolved step sequences ready for execution.

## What is a Skill?

A skill is a named, versioned playbook consisting of:
- A **description** of what it does
- A **parameter schema** (JSON Schema) declaring what inputs it accepts
- An ordered **step sequence** — each step is either a prompt template or a tool call descriptor

Steps use `{{paramName}}` placeholders that get substituted at execution time. The tool resolves templates but never executes other tools — the agent does that.

## MCP Operations

| Action | Description |
|--------|-------------|
| `define_skill` | Create or update a named skill (idempotent — increments version on update) |
| `execute_skill` | Resolve a skill's steps with provided parameters |
| `get_skill` | Retrieve a skill definition by name or UUID |
| `list_skills` | Paginated list of all skills |
| `delete_skill` | Remove a skill by name or UUID |

## Endpoints

- `GET /health` — `{ ok: true, service: "lm-studio-skills-tool", version: "2.1.0" }`
- `GET /tool-schema` — Tool schema JSON
- `POST /tools/skills` — All operations via `action` field
- MCP: `node dist/mcp-server.js` (stdio)

**Default port**: `3341`

## Tool Schema

All operations use a single flat input shape. Set `action` and populate the relevant fields:

```typescript
// define_skill
{
  action: "define_skill",
  name: "kebab-case-name",          // required, kebab-case
  description: "What this skill does",
  paramSchema: {
    type: "object",
    properties: { target: { type: "string", description: "..." } },
    required: ["target"]
  },
  steps: [
    { type: "prompt", template: "Analyze {{target}} and summarize findings." },
    { type: "tool_call", tool: "terminal", args: { command: "echo {{target}}" } }
  ]
}

// execute_skill
{ action: "execute_skill", name: "my-skill", params: { target: "value" } }

// get_skill
{ action: "get_skill", name: "my-skill" }
// or by UUID:
{ action: "get_skill", id: "uuid-here" }

// list_skills
{ action: "list_skills", limit: 20, offset: 0 }

// delete_skill
{ action: "delete_skill", name: "my-skill" }
```

## Response Shape

```json
{
  "success": true,
  "data": { ... }
}
```

On error: `{ "success": false, "errorCode": "NOT_FOUND|INVALID_INPUT|EXECUTION_FAILED", "errorMessage": "..." }`

## Example: Define and Execute

```bash
# Define a skill
curl -X POST http://localhost:3341/tools/skills \
  -H "Content-Type: application/json" \
  -d '{
    "action": "define_skill",
    "name": "debug-failing-test",
    "description": "Standard workflow for debugging a failing test",
    "paramSchema": {
      "type": "object",
      "properties": {
        "testFile": { "type": "string" },
        "errorMessage": { "type": "string" }
      },
      "required": ["testFile", "errorMessage"]
    },
    "steps": [
      { "type": "prompt", "template": "Read {{testFile}} and understand the test structure." },
      { "type": "tool_call", "tool": "terminal", "args": { "command": "npx jest {{testFile}} --no-coverage" } },
      { "type": "prompt", "template": "The error is: {{errorMessage}}. Identify the root cause and propose a fix." }
    ]
  }'

# Execute it
curl -X POST http://localhost:3341/tools/skills \
  -d '{
    "action": "execute_skill",
    "name": "debug-failing-test",
    "params": {
      "testFile": "src/math.test.ts",
      "errorMessage": "Expected 4 but received 5"
    }
  }'
```

The response contains `resolvedSteps` — the step sequence with all `{{placeholders}}` substituted.

## Validation Rules

- `name` must match `/^[a-z0-9]+(-[a-z0-9]+)*$/` (kebab-case)
- `description` max 1000 characters
- `steps` must be non-empty, max 100 steps
- Prompt steps require `template`; tool_call steps require `tool`
- Placeholder names must match `/^\w+$/`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKILLS_DB_PATH` | `./skills.db` (relative to script dir) | SQLite database path |
| `PORT` | `3341` | HTTP server port |

## LM Studio Integration

```json
{
  "mcpServers": {
    "skills": {
      "command": "node",
      "args": ["Skills/dist/mcp-server.js"],
      "env": {
        "SKILLS_DB_PATH": "./skills.db"
      }
    }
  }
}
```

## Setup

```bash
cd Skills
npm install
npm run build
```

## License

Non-Commercial License. See ../LICENSE.
Original Author: Shawna Pakbin
