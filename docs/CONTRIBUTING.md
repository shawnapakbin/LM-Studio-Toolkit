# Contributing to LLM Toolkit

## Quick Start

### Set Up Local Development
```bash
git clone https://github.com/shawnapakbin/llm-toolkit-by-shawna.git llm-toolkit
cd llm-toolkit
npm install
npm run build
npm test
```

## Contributor Attribution Policy

- Original author attribution must remain: Shawna Pakbin.
- Any contributor may add their name to contributor attribution records.
- No contributor may delete, alter, or obscure any existing contributor name.
- Pull requests that remove prior contributor attribution may be rejected.

### Making Changes

#### 1. Before You Start
- Create a branch: `git checkout -b feat/tool-name` or `fix/issue-description`
- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design
- Read [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md) for standards


#### 2. Write Code
- Follow the [Tool Contract Pattern](docs/ARCHITECTURE.md#1-tool-contract-pattern)
- **Enforce tool call normalization**: All new tool or workflow entry points must use the shared normalization utility (`shared/toolCallNormalizer.ts`) to ensure canonical tool call schema and compatibility across the system.
- Use standardized response envelope (see `testing/responses.ts`)
- Add error handling with proper error codes
- Include JSDoc comments on all exports

#### 3. Test Locally
```bash
npm run format        # Fix formatting
npm run lint          # Fix linting issues
npm run type-check    # Verify type safety
npm test              # Run test suite (must be 80%+ coverage)
npm run check         # Final pre-commit check
```

#### 4. Commit & Push
```bash
git add .
git commit -m "feat(ToolName): description of change"
git push origin your-branch-name
```

#### 5. Create Pull Request
- Title: `feat(ToolName): what changed`
- Description: Explain **why** this change is needed
- Link related issues
- If the PR introduces next-version feature scope, update [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md)

#### 6. Mark vNext Scope
- Use [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md) as the source of truth for intentional upcoming-release features.
- Feature-level additions not listed there may be treated as out-of-scope drift during release hardening.

---

## PR Title Format

Use conventional commits:

```
feat(Terminal): add command allowlist mode
fix(WebBrowser): block private IP addresses
docs(Architecture): update agent loop diagram
test(Calculator): add edge case tests
refactor(Memory): optimize SQL query performance
chore(CI): update GitHub Actions workflow
```

---

## Code Review Checklist

### Before Approving, Check:

- [ ] **Biome check passes**
  ```bash
  npm run check:ci
  ```
  Must show "No issues found"

- [ ] **Tests pass with 80%+ coverage**
  ```bash
  npm run test:ci
  ```
  Coverage report shows threshold met

- [ ] **Type safety enforced**
  ```bash
  npm run type-check
  ```
  No implicit `any` errors

- [ ] **JSDoc on all exports**
  - Function: `@param`, `@returns`, `@example`
  - Class: Purpose + method docs
  - Complex logic: Inline comments explaining why (not what)

- [ ] **Error codes consistent**
  - Check against [CODE-QUALITY.md#error-codes](docs/CODE-QUALITY.md)
  - Uses `INVALID_INPUT`, `TIMEOUT`, `POLICY_BLOCKED`, etc.

- [ ] **Memory integration** (if applicable)
  - Tool operations logged to SQLite
  - Decision rationale captured
  - Failures recorded for learning

- [ ] **Performance SLA met**
  - Benchmark tests passed
  - No regression in response time

- [ ] **No hardcoded secrets**
  - `.env.example` shows required vars
  - No API keys in code
  - Credentials loaded from environment

- [ ] **Security reviewed** (if tool modifies system)
  - Deny patterns tested
  - Sandbox working (cwd, network, etc.)
  - Error messages don't leak sensitive info

- [ ] **Documentation updated**
  - [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) reflects changes
  - Tool README updated if new tool
  - AGENT_ROADMAP.md updated for Phase progress
  - [docs/VNEXT_FEATURES.md](docs/VNEXT_FEATURES.md) updated if new release scope

---

## Adding a New Tool

### 1. Project Structure
```bash
mkdir MyTool
cd MyTool
# Create structure
cat > package.json << 'EOF'
{
  "name": "llm-toolkit-mytool",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "cors": "^2.8.5",
    "dotenv": "^16.6.1",
    "express": "^4.21.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/express": "^4.17.23",
    "@types/jest": "^29.5.0",
    "@types/node": "^22.13.1",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.8.2"
  }
}
EOF

mkdir -p src tests
touch src/index.ts src/mcp-server.ts tests/mytool.test.ts
```

### 2. Implement HTTP Handler ([src/index.ts](Terminal/src/index.ts) as template)
```typescript
import express from 'express';
import { z } from 'zod';
import { createResponse } from '../../testing/responses';

const app = express();
app.use(express.json());

const inputSchema = z.object({
  // Define your input schema
});

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

app.get('/tool-schema', (_, res) => {
  res.json({
    name: 'my_tool',
    description: 'Tool description',
    inputSchema: {
      // Schema definition
    }
  });
});

app.post('/tools/my_tool', async (req, res) => {
  try {
    const input = inputSchema.parse(req.body);
    const result = await executeMyTool(input);
    res.json(createResponse(true, result));
  } catch (err) {
    res.json(createResponse(false, undefined, {
      code: 'INVALID_INPUT',
      message: (err as Error).message
    }));
  }
});

const PORT = process.env.PORT || 3336;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
```

### 3. Implement MCP Server ([src/mcp-server.ts](Terminal/src/mcp-server.ts) as template)
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'my-tool-mcp',
  version: '1.0.0',
});

server.tool('my_tool', {
  description: 'Tool description',
  inputSchema: z.object({
    // Same schema as HTTP
  }),
  handler: async (input) => {
    const result = await executeMyTool(input);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
});

process.on('SIGINT', () => {
  server.close().catch(console.error);
  process.exit(0);
});

server.connect(process.stdin, process.stdout).catch(console.error);
```

### 4. Write Tests (85%+ coverage)
```typescript
// tests/mytool.test.ts
import { MemoryStore } from '../../Memory/src';
import * as request from 'supertest';

describe('MyTool', () => {
  let app: Express.Application;
  let memory: MemoryStore;

  beforeEach(() => {
    memory = new MemoryStore(':memory:');
    app = require('../src/index').app;
  });

  test('should handle valid input', async () => {
    const res = await request(app)
      .post('/tools/my_tool')
      .send({ /* valid input */ });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should reject invalid input', async () => {
    const res = await request(app)
      .post('/tools/my_tool')
      .send({ /* invalid */ });
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });
});
```

### 5. Create README
```markdown
# MyTool

Description of what this tool does.

## Capabilities

- Capability 1
- Capability 2

## Input Example

```json
{ "input": "example" }
```

## Output Example

```json
{
  "success": true,
  "data": { /* result */ },
  "timing": { "durationMs": 42, "startTime": "..." },
  "traceId": "..."
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3336 | HTTP server port |

## MCP Server

```
command: node
args: ["dist/mcp-server.js"]
```
```

### 6. Commit & PR
```bash
git add MyTool/
git commit -m "feat(MyTool): add new tool for X"
git push origin feat/mytools
```

---

## Reporting Issues

### Bug Report Template
```markdown
## Description
[Clear description of the issue]

## Steps to Reproduce
1. Run `...`
2. Observe `...`

## Expected Behavior
[What should happen]

## Actual Behavior
[What happens instead]

## Environment
- OS: Windows/macOS/Linux
- Node: (output of `node --version`)

## Error Log
```
[Paste error output]
```
```

### Feature Request Template
```markdown
## Description
[What you want to build]

## Motivation
[Why this is useful for the agent]

## Acceptance Criteria
- [ ] Can do X
- [ ] Can do Y

## Related Issues
Fixes #123
```

---

## Questions?

- **Architecture questions**: Check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Code quality standards**: See [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md)
- **Memory patterns**: Read [docs/MEMORY-PATTERNS.md](docs/MEMORY-PATTERNS.md)
- **Slash commands**: See [docs/SLASH-COMMANDS.md](docs/SLASH-COMMANDS.md)
- **CLI commands**: See [CLI/README.md](CLI/README.md)
- **Stuck on tests**: See examples in existing tools (Terminal, Calculator, etc.)

---

**Thank you for contributing! 🙏**
