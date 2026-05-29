# Clock Tool

Realtime date/time helper for LM Studio with timezone and locale-aware output. Provides current datetime in multiple formats (ISO 8601, Unix timestamp, localized strings) with structured date/time components.

## Features

- **Timezone Support**: All IANA timezone names (e.g., `America/New_York`, `Asia/Tokyo`)
- **Locale Formatting**: Localized date/time strings (e.g., `en-US`, `fr-FR`, `ja-JP`)
- **Multiple Formats**: ISO 8601, Unix timestamp, human-readable strings
- **Structured Components**: Separate year, month, day, hour, minute, second fields
- **UTC + Local Time**: Both UTC and localized timestamps in one response
- **Timezone Context**: Offset (`+05:30`), abbreviation (`IST`), and full name

## Endpoints

- **GET** `/tool-schema` — Returns the tool schema for LM Studio
- **POST** `/tools/get_current_datetime` — Gets the current date and time
- **GET** `/health` — Returns `{"status":"ok"}` for monitoring
- **MCP Server**: `node dist/mcp-server.js` (stdio-based MCP protocol)

**Default Server URL**: `http://localhost:3337`

## Tool Schema

### `get_current_datetime`

Returns the current date and time with timezone and locale formatting.

#### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `timeZone` | `string` | No | System timezone | IANA timezone name (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`). If empty or omitted, uses system timezone. |
| `locale` | `string` | No | `en-US` | BCP 47 locale tag for formatting (e.g., `en-US`, `fr-FR`, `ja-JP`, `de-DE`). Affects date/time string output. |

#### Response Format

```json
{
  "utc": {
    "iso": "2025-01-15T08:30:45.123Z",
    "timestamp": 1736932245123,
    "dateTime": "1/15/2025, 8:30:45 AM"
  },
  "local": {
    "iso": "2025-01-15T14:00:45.123+05:30",
    "timestamp": 1736932245123,
    "dateTime": "1/15/2025, 2:00:45 PM",
    "date": "1/15/2025",
    "time": "2:00:45 PM",
    "year": 2025,
    "month": 1,
    "day": 15,
    "hour": 14,
    "minute": 0,
    "second": 45,
    "millisecond": 123,
    "dayOfWeek": "Wednesday"
  },
  "timeZone": {
    "name": "Asia/Kolkata",
    "abbreviation": "IST",
    "offset": "+05:30"
  },
  "locale": "en-US"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `utc.iso` | `string` | UTC timestamp in ISO 8601 format (e.g., `2025-01-15T08:30:45.123Z`) |
| `utc.timestamp` | `number` | Unix timestamp in milliseconds |
| `utc.dateTime` | `string` | Localized UTC datetime string |
| `local.iso` | `string` | Local timestamp in ISO 8601 format with timezone offset |
| `local.timestamp` | `number` | Unix timestamp in milliseconds (same as `utc.timestamp`) |
| `local.dateTime` | `string` | Localized datetime string (e.g., `1/15/2025, 2:00:45 PM`) |
| `local.date` | `string` | Localized date string (e.g., `1/15/2025`) |
| `local.time` | `string` | Localized time string (e.g., `2:00:45 PM`) |
| `local.year` | `number` | Year (e.g., `2025`) |
| `local.month` | `number` | Month (1–12) |
| `local.day` | `number` | Day of month (1–31) |
| `local.hour` | `number` | Hour (0–23) |
| `local.minute` | `number` | Minute (0–59) |
| `local.second` | `number` | Second (0–59) |
| `local.millisecond` | `number` | Millisecond (0–999) |
| `local.dayOfWeek` | `string` | Day of week (e.g., `Wednesday`) |
| `timeZone.name` | `string` | IANA timezone name (e.g., `Asia/Kolkata`) |
| `timeZone.abbreviation` | `string` | Timezone abbreviation (e.g., `IST`, `EST`) |
| `timeZone.offset` | `string` | UTC offset (e.g., `+05:30`, `-05:00`) |
| `locale` | `string` | Locale used for formatting (e.g., `en-US`) |

## Setup Instructions

### 1. Install Dependencies

```bash
cd Clock
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

**Available Environment Variables**:

```env
CLOCK_PORT=3337
CLOCK_DEFAULT_TIMEZONE=
CLOCK_DEFAULT_LOCALE=en-US
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CLOCK_PORT` | `3337` | HTTP server port |
| `CLOCK_DEFAULT_TIMEZONE` | System timezone | Default IANA timezone name (empty = system timezone) |
| `CLOCK_DEFAULT_LOCALE` | `en-US` | Default BCP 47 locale tag |

### 3. Run the Server

#### HTTP Server (for direct API calls)

```bash
npm run dev
```

The server will start on `http://localhost:3337`.

#### MCP Server (for LM Studio integration)

```bash
npm run build
```

This compiles TypeScript to `dist/mcp-server.js`.

## Example API Calls

### Default (System Timezone)

```bash
curl -X POST http://localhost:3337/tools/get_current_datetime \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Specific Timezone

```bash
curl -X POST http://localhost:3337/tools/get_current_datetime \
  -H "Content-Type: application/json" \
  -d '{"timeZone":"Asia/Kolkata","locale":"en-US"}'
```

### Different Locale (French)

```bash
curl -X POST http://localhost:3337/tools/get_current_datetime \
  -H "Content-Type: application/json" \
  -d '{"timeZone":"Europe/Paris","locale":"fr-FR"}'
```

**Response** (French locale):
```json
{
  "local": {
    "dateTime": "15/01/2025 14:00:45",
    "date": "15/01/2025",
    "time": "14:00:45",
    "dayOfWeek": "mercredi"
  }
}
```

### Japanese Locale

```bash
curl -X POST http://localhost:3337/tools/get_current_datetime \
  -H "Content-Type: application/json" \
  -d '{"timeZone":"Asia/Tokyo","locale":"ja-JP"}'
```

**Response** (Japanese locale):
```json
{
  "local": {
    "dateTime": "2025/1/15 23:00:45",
    "date": "2025/1/15",
    "time": "23:00:45",
    "dayOfWeek": "水曜日"
  }
}
```

## LM Studio Integration

Add this configuration to your LM Studio `mcp.json`:

```json
{
  "mcpServers": {
    "clock": {
      "command": "node",
      "args": ["Clock/dist/mcp-server.js"],
      "env": {
        "CLOCK_DEFAULT_TIMEZONE": "",
        "CLOCK_DEFAULT_LOCALE": "en-US"
      }
    }
  }
}
```

**Tip**: From repo root, run `npm run mcp:print-config` to print a ready-to-paste config with absolute paths for your current folder.

**Environment Variables** (optional):
- `CLOCK_DEFAULT_TIMEZONE`: Default IANA timezone (empty = system timezone)
- `CLOCK_DEFAULT_LOCALE`: Default locale for formatting

## Common Timezones

| Region | Timezone | UTC Offset (Standard) |
|--------|----------|------------------------|
| **US East Coast** | `America/New_York` | UTC-5 (EST) / UTC-4 (EDT) |
| **US West Coast** | `America/Los_Angeles` | UTC-8 (PST) / UTC-7 (PDT) |
| **UK** | `Europe/London` | UTC+0 (GMT) / UTC+1 (BST) |
| **Central Europe** | `Europe/Paris` | UTC+1 (CET) / UTC+2 (CEST) |
| **India** | `Asia/Kolkata` | UTC+5:30 (IST) |
| **China** | `Asia/Shanghai` | UTC+8 (CST) |
| **Japan** | `Asia/Tokyo` | UTC+9 (JST) |
| **Australia (Sydney)** | `Australia/Sydney` | UTC+10 (AEST) / UTC+11 (AEDT) |

For a full list, see: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones

## Common Locales

| Locale | Language | Region | Date Format Example |
|--------|----------|--------|---------------------|
| `en-US` | English | United States | `1/15/2025, 2:00:45 PM` |
| `en-GB` | English | United Kingdom | `15/01/2025, 14:00:45` |
| `fr-FR` | French | France | `15/01/2025 14:00:45` |
| `de-DE` | German | Germany | `15.1.2025, 14:00:45` |
| `ja-JP` | Japanese | Japan | `2025/1/15 14:00:45` |
| `zh-CN` | Chinese | China (Simplified) | `2025/1/15 14:00:45` |
| `es-ES` | Spanish | Spain | `15/1/2025, 14:00:45` |
| `pt-BR` | Portuguese | Brazil | `15/01/2025 14:00:45` |

## Use Cases

### 1. LLM Timestamp Awareness

LLMs can use this tool to know the current time when answering questions:
- "What time is it in Tokyo?"
- "What's the date today?"
- "Is it still morning in New York?"

### 2. Logging and Auditing

Include structured timestamps in logs with timezone context:
```json
{
  "event": "user_login",
  "timestamp": 1736932245123,
  "timezone": "America/New_York",
  "local_time": "1/15/2025, 8:30:45 AM"
}
```

### 3. Multi-Region Applications

Display times in different regions:
```javascript
// Get time in three regions
const ny = await getClock({ timeZone: "America/New_York" });
const london = await getClock({ timeZone: "Europe/London" });
const tokyo = await getClock({ timeZone: "Asia/Tokyo" });
```

### 4. User-Specific Localization

Format dates according to user preferences:
```javascript
const userTimezone = "Europe/Paris";
const userLocale = "fr-FR";
const time = await getClock({ timeZone: userTimezone, locale: userLocale });
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Invalid timeZone` | Unrecognized timezone name | Use IANA timezone names (e.g., `America/New_York`) |
| `Port 3337 already in use` | Another process is using port 3337 | Change `CLOCK_PORT` in `.env` |
| Incorrect date format | Wrong locale | Check locale spelling (e.g., `en-US`, not `en_US`) |
| System timezone used | Empty `timeZone` parameter | Explicitly set `timeZone` parameter |

## Development Commands

```bash
npm run dev          # Start HTTP server (development mode with auto-reload)
npm run dev:mcp      # Test MCP server (stdio mode)
npm run build        # Compile TypeScript to dist/
npm test             # Run tests (if available)
```

## Implementation Notes

- Uses native JavaScript `Date` and `Intl` APIs (no external dependencies)
- Timezone data is automatically updated by Node.js (from IANA tzdata)
- Locale formatting uses `Intl.DateTimeFormat` for accurate localization
- All timestamps are consistent (same Unix millisecond value for UTC and local)
- Daylight Saving Time (DST) is automatically handled

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
