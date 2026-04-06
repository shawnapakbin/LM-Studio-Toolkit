# Code Quality Standards

## Test Coverage

### Minimum Requirements
- **Global**: 80% statement coverage, 70% branch coverage
- **Terminal**: 85% (command safety is critical)
- **Calculator**: 90% (deterministic math functions)
- **All other tools**: 80%

### CI Gate
Tests must pass **before** merging:
```bash
npm run test:ci  # Exits 1 if coverage < threshold
```

### Coverage Reports
After running tests, check `coverage/coverage-summary.json`:
```bash
npm test
open coverage/lcov-report/index.html
```

---

## Type Safety

### TypeScript Configuration
- **Mode**: `strict: true` (no escape hatches)
- **No `any`**: Use `unknown` with type guards instead
  ```typescript
  // ❌ BAD
  function process(data: any) { }
  
  // ✅ GOOD
  function process(data: unknown) {
    if (typeof data === 'string') {
      // Now TypeScript knows it's a string
    }
  }
  ```

### Type Checking in CI
```bash
npm run type-check  # Fails if any type errors
```

---

## Code Style (Biome)

### Automatic Formatting
```bash
npm run format      # Fix all formatting issues
npm run check       # Fix format + lint + organize imports
```

### Pre-commit
Before pushing:
```bash
npm run check:ci    # CI will run this; fail early locally
```

### Rules
- **Line width**: 100 characters
- **Indentation**: 2 spaces
- **Trailing commas**: ES5 (objects + arrays only, not function params)
- **Semicolons**: Always required
- **Quotes**: Double quotes (JSX, etc.)

### Violations (Auto-fixed by Biome)
- Unused imports → Removed
- Unused variables → Warning (check for logic errors)
- Implicit `any` → Error (requires explicit type)
- Global `eval()` → Error (security)

---

## Documentation

### JSDoc Requirements
All exported functions **must** have JSDoc:

```typescript
/**
 * Executes a terminal command on the local machine.
 * 
 * @param command - The shell command to run (OS-specific)
 * @param timeoutMs - Timeout in milliseconds (default: 60000)
 * @returns ToolResponse with stdout, stderr, exit code
 * @throws Error if command is denied by policy
 * 
 * @example
 * const result = await runTerminal('npm test', 30000);
 * if (result.success) console.log(result.data.stdout);
 */
export async function runTerminal(
  command: string,
  timeoutMs?: number
): Promise<ToolResponse> {
  // ...
}
```

### File Headers
No copyright headers needed (license in repo root). Add this to `src/index.ts` top:
```typescript
/**
 * LLM Toolkit Tool: {Tool Name}
 * 
 * Part of LLM Toolkit
 * Model Context Protocol (MCP) server + HTTP endpoint
 */
```

### README Requirements
Each tool folder must have `README.md` with:
- Tool purpose (1 sentence)
- Capabilities (bulleted list)
- Input/output example
- Environment variables
- MCP server path

---

## Performance SLAs

### Tool-Specific Limits
| Tool | SLA | Measurement |
|------|-----|-------------|
| Terminal | 10 seconds | P95 response time |
| WebBrowser | 20 seconds | P95 response time |
| Calculator | 1 second | P95 response time |
| Clock | 100 ms | P95 response time |
| Browserless | 30 seconds | P95 response time |

### Benchmark Tests
```bash
npm run benchmark  # Runs perf tests; fails if SLA exceeded
```

Add benchmark for each tool:
```typescript
// benchmarks/performance.test.ts
test('Terminal: echo should respond < 100ms', async () => {
  const start = Date.now();
  const result = await tool.run('echo hello');
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(100);
});
```

### CI Alert
If SLA is breached, CI logs warning:
```
⚠️  PERFORMANCE SLA BREACH
Tool: Terminal
SLA: 10000ms, Actual: 12500ms
Potential reasons: CPU-bound operation, network latency
```

---

## Code Review Checklist

Before approving a PR, verify:

- [ ] **Biome passes**: `npm run check:ci` (no errors/warnings)
- [ ] **Tests pass**: `npm run test:ci` (coverage >= threshold)
- [ ] **Type-safe**: `npm run type-check` (no implicit `any`)
- [ ] **JSDoc complete**: All exported functions documented
- [ ] **Architecture.md updated**: If design change (new tool, pattern)
- [ ] **Memory integrated**: If tool creates side effects
  ```typescript
  await memory.recordToolCall(taskRunId, toolName, input, output, success);
  ```
- [ ] **Error codes consistent**: Uses standard error codes
  - `INVALID_INPUT` — Schema validation failed
  - `TIMEOUT` — Exceeded timeout
  - `POLICY_BLOCKED` — Denied by security policy
  - `EXECUTION_FAILED` — Runtime error
  - `EXTERNAL_SERVICE_ERROR` — API/network failure
  - `RESOURCE_EXHAUSTED` — Concurrency limit hit
- [ ] **Performance SLA met**: Benchmark tests passed
- [ ] **No secrets in code**: `.env.example` shows what's required

---

## Common Issues

### Issue: "noUnusedLocals" warning
**Fix**: Remove the variable OR prefix with `_`:
```typescript
const _unusedVar = await fetch(...);  // Intentionally unused
```

### Issue: "noImplicitAny" error
**Fix**: Add explicit type:
```typescript
// ❌ BAD
const data = JSON.parse(input);

// ✅ GOOD
const data: unknown = JSON.parse(input);
if (typeof data === 'object') { ... }
```

### Issue: Test coverage < 80%
**Fix**: Add more tests + mock external calls:
```typescript
jest.mock('../src/fetch', () => ({
  fetch: jest.fn().mockResolvedValue({ ok: true })
}));
```

---

## Continuous Improvement

### Monthly Review
- Check CI success rate (aim for 99%+ green)
- Review code coverage trends (ensure not declining)
- Measure performance SLA braaches (fix systematically)
- Collect linting violations (update rules if needed)

### Adding New Rules
If a bug pattern keeps reoccurring:
1. Add Biome linting rule (if available)
2. Update `biome.json`
3. Run `npm run check --apply` to fix codebase
4. Document why in this file

---

**Last Updated**: April 2026  
**Owner**: LLM Toolkit Team
