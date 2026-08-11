# LAN Sub Agent

**Version**: 1.0.0  
**MCP Tools**: `dispatch_lan_tasks`, `get_lan_status`, `discover_endpoints`, `get_lan_telemetry`

LAN-aware multi-endpoint inference dispatcher that distributes sub-agent tasks across multiple LM Studio instances on the local network. Solves the concurrency deadlock where the local LM Studio instance cannot serve itself during sub-task execution.

## Features

- **Multi-Endpoint Configuration** — JSON config file with hot-reload (no restart needed)
- **Health Checking** — Periodic HTTP probes with configurable failure thresholds
- **Load Balancing** — Round-robin, least-connections, or weighted strategies
- **UDP Discovery** — Automatic detection of LM Studio instances on the LAN
- **Self-Exclusion** — Never dispatches back to the calling instance (resolves localhost/127.0.0.1/LAN IP equivalence)
- **Graceful Degradation** — Redistributes tasks when endpoints fail mid-dispatch
- **Checkpoint/Resume** — Crash recovery via persistent task checkpoints
- **Per-Endpoint Telemetry** — Response times, failure rates, token throughput per machine
- **Browser GUI** — Visual endpoint management at `http://localhost:9847`

## MCP Tools

| Tool | Description |
|------|-------------|
| `dispatch_lan_tasks` | Distribute inference tasks across healthy LAN endpoints |
| `get_lan_status` | View endpoint health, active tasks, and model availability |
| `discover_endpoints` | Trigger UDP broadcast scan for new LM Studio instances |
| `get_lan_telemetry` | Per-endpoint performance metrics with optional filters |

## Configuration

Default config file: `./lan-subagent-config.json`

```json
{
  "endpoints": [
    {
      "id": "studio-desktop",
      "host": "192.168.1.10",
      "port": 1234,
      "models": ["qwen2.5-coder-32b"],
      "maxConcurrency": 4,
      "enabled": true
    }
  ],
  "loadBalancer": { "strategy": "round-robin", "retryLimit": 2 },
  "healthCheck": { "intervalSeconds": 30, "timeoutMs": 5000, "failureThreshold": 2 },
  "discovery": { "enabled": true, "intervalSeconds": 60, "broadcastPort": 41234, "maxDiscovered": 50 },
  "localInstance": { "host": "localhost", "port": 1234 },
  "gui": { "port": 9847, "enabled": true }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUBAGENT_LOCAL_HOST` | `localhost` | Local LM Studio host (for self-exclusion) |
| `SUBAGENT_LOCAL_PORT` | `1234` | Local LM Studio port (for self-exclusion) |

## Build & Test

```bash
npm run -w LanSubAgent build    # Compile TypeScript
npm run -w LanSubAgent test     # Run all tests (unit + property + integration)
```

## Architecture

See [.kiro/specs/lan-sub-agent/design.md](../.kiro/specs/lan-sub-agent/design.md) for the full design document including component diagrams, data models, and 18 correctness properties verified via property-based testing.
