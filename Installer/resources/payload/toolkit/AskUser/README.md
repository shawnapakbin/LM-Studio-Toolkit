# LM Studio Tools - AskUser

Interactive interview tool for collecting clarifications before implementation.

## Features
- Two-step async interview flow: create and submit responses
- Supports question types: text, single choice, multi choice, number, confirm
- Persists interviews in SQLite for reliability across restarts
- Available as HTTP and MCP server

## HTTP Endpoints
- `GET /health`
- `GET /tool-schema`
- `POST /tools/ask_user_interview`

## Example request

```json
{
  "action": "create",
  "title": "Clarify feature",
  "questions": [
    {
      "id": "scope",
      "type": "single_choice",
      "prompt": "Choose scope",
      "required": true,
      "options": [
        { "id": "mvp", "label": "MVP" },
        { "id": "full", "label": "Full" }
      ]
    }
  ]
}
```
