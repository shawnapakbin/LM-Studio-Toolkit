# Calculator Tool

Engineering and scientific expression evaluator for LM Studio. Supports mathematical expressions, trigonometry, engineering notation (k, M, G), unit conversions, and Unicode symbol normalization.

## Features

- **Mathematical Expressions**: Standard operators (`+`, `-`, `*`, `/`, `^`, `%`)
- **Trigonometry**: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`
- **Engineering Notation**: `5k` (5000), `2M` (2,000,000), `1G` (1,000,000,000)
- **Unit Conversions**: Convert between units using natural syntax: `10 inch to cm`, `5 miles to km`
- **Unicode Support**: Automatically normalizes `π` → `pi`, `°` → degree symbol, `×` → `*`, `÷` → `/`, `√` → `sqrt()`, superscripts → `^`
- **High Precision**: Up to 20 decimal places (configurable)
- **Constant Literals**: `pi`, `e`, `tau`, `phi`

## Endpoints

- **GET** `/tool-schema` — Returns the tool schema for LM Studio
- **POST** `/tools/calculate_engineering` — Evaluates an engineering expression
- **GET** `/health` — Returns `{"status":"ok"}` for monitoring
- **MCP Server**: `node dist/mcp-server.js` (stdio-based MCP protocol)

**Default Server URL**: `http://localhost:3335`

## Tool Schema

### `calculate_engineering`

Evaluates an engineering or scientific expression.

#### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `expression` | `string` | **Yes** | — | The mathematical expression to evaluate. Supports math operators, trig functions, engineering notation, and unit conversions. |
| `precision` | `number` | No | `12` | Number of decimal places (1–20). Defaults to `CALCULATOR_DEFAULT_PRECISION` env var. |

#### Response Format

```json
{
  "result": "1.0000000000",
  "expression": "sin(pi/6)^2 + cos(pi/6)^2",
  "precision": 10
}
```

| Field | Type | Description |
|-------|------|-------------|
| `result` | `string` | The calculated result as a string (preserves precision) |
| `expression` | `string` | The original expression (echoed back) |
| `precision` | `number` | The precision used for the calculation |

## Supported Symbols and Normalization

The calculator normalizes Unicode symbols to their ASCII equivalents:

| Unicode Symbol | Normalization | Example |
|----------------|---------------|----------|
| `π` | `pi` | `2π` → `2*pi` |
| `°` | (degree marker) | `sin(30°)` → `sin(30 deg)` |
| `×` | `*` | `5×3` → `5*3` |
| `÷` | `/` | `10÷2` → `10/2` |
| `√` | `sqrt()` | `√16` → `sqrt(16)` |
| Superscripts (⁰-⁹) | `^` | `x²` → `x^2` |
| Subscripts (₀-₉) | Removed | `x₁` → `x1` |
| Fractions (`½`, `¼`, `¾`, `⅓`, `⅔`) | Decimal | `½` → `0.5` |

### Engineering Notation

| Suffix | Multiplier | Example | Result |
|--------|------------|---------|--------|
| `k` | 1,000 | `5k` | 5000 |
| `M` | 1,000,000 | `2M` | 2000000 |
| `G` | 1,000,000,000 | `1G` | 1000000000 |

### Unit Conversions (via `math.js`)

```
10 inch to cm
5 miles to km
100 kg to lbs
32 degF to degC
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd Calculator
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

**Available Environment Variables**:

```env
CALCULATOR_PORT=3335
CALCULATOR_DEFAULT_PRECISION=12
CALCULATOR_MAX_PRECISION=20
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CALCULATOR_PORT` | `3335` | HTTP server port |
| `CALCULATOR_DEFAULT_PRECISION` | `12` | Default decimal places (if `precision` not provided) |
| `CALCULATOR_MAX_PRECISION` | `20` | Maximum allowed decimal places |

### 3. Run the Server

#### HTTP Server (for direct API calls)

```bash
npm run dev
```

The server will start on `http://localhost:3335`.

#### MCP Server (for LM Studio integration)

```bash
npm run build
```

This compiles TypeScript to `dist/mcp-server.js`.

## Example API Calls

### Basic Expression

```bash
curl -X POST http://localhost:3335/tools/calculate_engineering \
  -H "Content-Type: application/json" \
  -d '{"expression":"2 + 2","precision":2}'
```

**Response**:
```json
{
  "result": "4.00",
  "expression": "2 + 2",
  "precision": 2
}
```

### Trigonometry

```bash
curl -X POST http://localhost:3335/tools/calculate_engineering \
  -H "Content-Type: application/json" \
  -d '{"expression":"sin(pi/6)^2 + cos(pi/6)^2","precision":14}'
```

**Response**:
```json
{
  "result": "1.00000000000000",
  "expression": "sin(pi/6)^2 + cos(pi/6)^2",
  "precision": 14
}
```

### Engineering Notation

```bash
curl -X POST http://localhost:3335/tools/calculate_engineering \
  -H "Content-Type: application/json" \
  -d '{"expression":"5k + 2M","precision":0}'
```

**Response**:
```json
{
  "result": "2005000",
  "expression": "5k + 2M",
  "precision": 0
}
```

### Unit Conversion

```bash
curl -X POST http://localhost:3335/tools/calculate_engineering \
  -H "Content-Type: application/json" \
  -d '{"expression":"10 inch to cm","precision":2}'
```

**Response**:
```json
{
  "result": "25.40",
  "expression": "10 inch to cm",
  "precision": 2
}
```

### Unicode Symbols

```bash
curl -X POST http://localhost:3335/tools/calculate_engineering \
  -H "Content-Type: application/json" \
  -d '{"expression":"2π×5","precision":4}'
```

**Response**:
```json
{
  "result": "31.4159",
  "expression": "2π×5",
  "precision": 4
}
```

## LM Studio Integration

Add this configuration to your LM Studio `mcp.json`:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": ["Calculator/dist/mcp-server.js"],
      "env": {
        "CALCULATOR_DEFAULT_PRECISION": "12",
        "CALCULATOR_MAX_PRECISION": "20"
      }
    }
  }
}
```

**Tip**: From repo root, run `npm run mcp:print-config` to print a ready-to-paste config with absolute paths for your current folder.

**Environment Variables** (optional):
- `CALCULATOR_DEFAULT_PRECISION`: Default decimal places (1–20)
- `CALCULATOR_MAX_PRECISION`: Maximum allowed decimal places

## Error Handling

If an expression cannot be evaluated, the tool returns an error message:

```json
{
  "error": "Invalid expression: Unexpected token ILLEGAL"
}
```

Common errors:
- **Syntax errors**: Missing operators, mismatched parentheses
- **Division by zero**: Results in `Infinity`
- **Invalid units**: Unrecognized unit names

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Cannot find module 'mathjs'` | Dependencies not installed | Run `npm install` |
| `Port 3335 already in use` | Another process is using port 3335 | Change `CALCULATOR_PORT` in `.env` |
| `Invalid expression` | Syntax error in expression | Check parentheses, operators, and function names |
| `Precision exceeded` | `precision` > `CALCULATOR_MAX_PRECISION` | Lower the precision or increase `CALCULATOR_MAX_PRECISION` |

## Development Commands

```bash
npm run dev          # Start HTTP server (development mode with auto-reload)
npm run dev:mcp      # Test MCP server (stdio mode)
npm run build        # Compile TypeScript to dist/
npm test             # Run tests (if available)
```

## Expression Examples

```javascript
// Basic arithmetic
"2 + 2 * 3"                    // 8

// Trigonometry
"sin(pi/4)"                    // 0.7071067812
"cos(30°)"                     // 0.8660254038 (degrees)

// Engineering notation
"5k + 10k"                     // 15000
"2M / 1k"                      // 2000

// Unit conversions
"10 inch to cm"                // 25.4
"100 kg to lbs"                // 220.46

// Complex expressions
"sqrt(2^2 + 3^2)"              // 3.6055512755
"(5k * 2M) / 1G"               // 10

// Unicode symbols
"2π×radius"                    // (if radius is defined)
"√16 + √25"                    // 9
"5×(3+2)"                      // 25
```

## Implementation Notes

- Uses [`mathjs`](https://mathjs.org/) for expression evaluation
- Supports all `mathjs` functions: `sin`, `cos`, `tan`, `log`, `sqrt`, `abs`, `round`, `ceil`, `floor`, etc.
- Engineering notation is preprocessed before evaluation
- Unicode normalization happens before parsing
- Precision is applied to the final result using `toFixed()`

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
