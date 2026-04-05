# LLM Toolkit Memory — SQLite Persistence Layer

**Part of LLM Toolkit (v2.2.0)**

SQLite-backed agent memory for persistent task history, solution pattern reuse, learned rules, and decision tracking.

## Purpose

The Memory module enables the orchestrator agent to:

1. **Learn from past tasks** — Replay successful solution patterns for similar prompts
2. **Track decisions** — Record why tool X was chosen over Y (explainability)
3. **Remember failures** — Capture what didn't work for backtracking
4. **Enforce learned rules** — SSRF blocks, command denylists, constraints discovered during execution

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `task_runs` | Task execution history (prompt, status, outcome, traceId) |
| `tool_calls` | Audit trail of every tool invocation (input, output, success, error code) |
| `solution_patterns` | Successful task traces for reuse (task hash, tool sequence, success rate) |
| `learned_rules` | SSRF blocks, command denylists, constraints (rule type, pattern, reason) |
| `agent_decisions` | Tool selection rationale (decision text, alternatives, confidence) |
| `failed_attempts` | What didn't work (failed tool, error reason, recovery attempt) |
| `session_context` | Conversation memory (user preferences, recent files, cwd) |

## Usage

### Creating a Memory Store

```typescript
import { MemoryStore } from '@llm-toolkit/memory';

// In-memory (tests)
const memory = new MemoryStore(':memory:');

// File-based (production)
const memory = new MemoryStore('./memory.db');
```

### Recording Task Execution

```typescript
const taskId = await memory.createTaskRun('Fix the failing test', traceId);

await memory.recordToolCall(
  taskId,
  'run_tests',
  { pattern: '*.test.ts' },
  { passed: 5, failed: 1 },
  false,
  'EXECUTION_FAILED',
  12345
);

await memory.recordDecision(
  taskId,
  1,
  'Selected read_file to understand test failure',
  ['generate_fix', 'ask_user'],
  0.85
);

await memory.updateTaskRun(taskId, 'completed', 'Test fixed');
```

### Reusing Solution Patterns

```typescript
// Record successful pattern
await memory.recordPattern(
  'Fix failing Jest test',
  ['read_file', 'run_tests', 'write_file', 'run_tests'],
  JSON.stringify([/* trace of tool calls */])
);

// Query for similar tasks in future
const patterns = await memory.findSimilarPatterns(
  'Jest test timeout needs fixing',
  3
);

// Replay if confidence high
if (patterns[0].success_rate > 0.95) {
  await agent.replayPattern(patterns[0], newTaskId);
}
```

### Learning Rules

```typescript
// Record a discovered rule
await memory.addRule(
  'ssrf_block',
  'localhost:*',
  'WebBrowser blocks localhost to prevent exfil'
);

// Retrieve learned rules at startup
const deniedHosts = await memory.getRules('ssrf_block');
// Now agent can enforce these constraints
```

## API Reference

### MemoryStore Class

#### `constructor(dbPath?: string)`
- `dbPath`: SQLite file path (default: `./memory.db`)
- Creates tables on first run via `initSchema()`

#### `createTaskRun(prompt: string, traceId: string): Promise<string>`
- Returns task ID (UUID)
- Status: `'planning'`

#### `updateTaskRun(taskRunId: string, status: string, outcome?: string): Promise<void>`
- Status: `'planning' | 'executing' | 'completed' | 'failed'`

#### `recordToolCall(taskRunId, toolName, input, output, success, errorCode?, durationMs?): Promise<void>`
- Captures full audit trail of tool invocation

#### `recordPattern(taskPrompt, toolSequence, trace): Promise<void>`
- `toolSequence`: Ordered list of tool names used
- `trace`: Serialized tool calls (JSON string) for replay

#### `findSimilarPatterns(prompt: string, limit?: number): Promise<SolutionPattern[]>`
- Searches by task hash (exact match) or substring similarity
- Ordered by `success_rate` DESC, `uses` DESC

#### `addRule(type: string, pattern: string, reason?: string): Promise<void>`
- `type`: Category (e.g., `'ssrf_block'`, `'command_deny'`)
- `pattern`: Regex or exact string pattern

#### `getRules(type: string): Promise<Rule[]>`
- Returns all rules of specified type

#### `recordDecision(taskRunId, stepNum, decision, alternatives?, confidence?): Promise<void>`
- `confidence`: 0.0–1.0 (default: 0.5)

#### `recordFailure(taskRunId, stepNum, tool, error): Promise<string>`
- Returns failure ID (for tracking recovery attempts)

#### `close(): Promise<void>`
- Closes database connection (cleanup on shutdown)

## Testing

```bash
npm test --workspace Memory
```

Tests use `:memory:` SQLite database (no file I/O, fast).

## Performance

### Query Latencies (1000 rows)

| Query | Time |
|-------|------|
| Create task run | < 1ms |
| Record tool call | < 2ms |
| Find similar patterns | 5–10ms |
| Get rules | 2–5ms |

### Index Strategy

Indexes on frequently queried columns:
- `task_runs.trace_id` (for linking http trace to memory)
- `tool_calls.task_run_id` (for fetching call history)
- `solution_patterns.task_hash` (for pattern lookup)

## Schema Versioning

Future upgrades handled via migrations:

```typescript
// Memory/src/migrations.ts (future)
export const migrations = [
  {
    version: 1,
    up: (db) => initSchema(db),
  },
  {
    version: 2,
    up: (db) => db.exec('ALTER TABLE task_runs ADD COLUMN ...'),
  },
];
```

## Cleanup & Archival

### Remove Old Runs
```typescript
// Not yet implemented; useful for production
// await memory.deleteOldRuns(daysOld: 90);
```

### Export for Analysis
```typescript
// Not yet implemented
// await memory.exportTaskRuns(taskRunId: string): JSON
```

---

## Integration Points

### From Orchestrator
```typescript
const memory = new MemoryStore('./memory.db');

// Before planning
const patterns = await memory.findSimilarPatterns(userPrompt);

// During execution
await memory.recordToolCall(taskId, toolName, input, output, success, errorCode);

// After completion
await memory.recordPattern(userPrompt, toolSequence, trace);
```

### From Tools (optional)
Tools can log their own learned rules:
```typescript
// Terminal tool
if (commandDenied) {
  await memory.addRule('command_deny', command, 'User attempted dangerous command');
}
```

---

## Known Limitations

- **Single process**: SQLite is not designed for high-concurrency writes (use connection pooling in future)
- **No cleanup**: Old records persist indefinitely (archival strategy needed for production)
- **No full-text search**: Pattern matching is simple substring/hash (can upgrade to FTS5 later)
- **No migrations**: Schema changes require manual DB deletion (auto-migrations added in Phase 2)

---

**Last Updated**: April 2026  
**Version**: 2.2.0  
**Owner**: LLM Toolkit Team
