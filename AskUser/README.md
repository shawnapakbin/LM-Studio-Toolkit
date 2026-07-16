# LLM Toolkit — AskUser

Interactive interview/approval tool that lets an AI agent pause and collect structured input from a human before proceeding. Designed for user approval workflows — situations where the agent needs clarification, confirmation, or a decision from the user before taking an action.

## How It Works (Two-Step Flow)

1. **Create** — The agent creates an interview with one or more questions. Each question has a type (text, single choice, multi choice, number, or confirm). The interview gets an ID and an expiration time.

2. **Get / Submit** — The user (or a UI layer) fetches the interview to display the questions, then submits responses back. The agent can poll with `get` to check if answers have come in.

Interviews are persisted in SQLite, so they survive process restarts.

## Supported Question Types

| Type | Description |
|------|-------------|
| `text` | Free-form text input (with optional min/max length) |
| `single_choice` | Pick one option from a list |
| `multi_choice` | Pick multiple options (with optional min/max selections) |
| `number` | Numeric input (with optional range and integer-only) |
| `confirm` | Yes/no boolean confirmation |

## Use Cases

- **Destructive action approval** — "Delete 1,247 records older than 90 days?"
- **Feature scoping** — "MVP or full implementation?"
- **Ambiguity resolution** — "Which of these 3 matching files did you mean?"
- **Deployment gates** — "Deploy to staging or production?"
- **Configuration choices** — "Which database engine: Postgres, MySQL, or SQLite?"

## HTTP Endpoints

- `GET /health`
- `GET /tool-schema`
- `GET /api/interviews/pending` — Returns all pending interviews (for UI polling)
- `POST /tools/ask_user_interview`
- `GET /ui` — Interactive interview form UI

## Interview UI

The tool includes a built-in web UI at `http://localhost:3338/ui` that:
- Polls for pending interviews every 2 seconds
- Renders interactive HTML forms with proper input controls per question type
- Validates required fields before submission
- Submits responses back to the API automatically
- Shows success/expiry states

Open the UI in any browser while the AskUser server is running. When an agent creates an interview, it appears automatically as an interactive form.

## Example: Destructive Action Approval

```json
{
  "action": "create",
  "payload": {
    "title": "Approve database cleanup",
    "expiresInSeconds": 3600,
    "questions": [
      {
        "id": "confirm_delete",
        "type": "confirm",
        "prompt": "Delete 1,247 records older than 90 days from the logs table?",
        "required": true
      },
      {
        "id": "backup_preference",
        "type": "single_choice",
        "prompt": "Should I create a backup first?",
        "required": true,
        "options": [
          { "id": "yes", "label": "Yes, backup before deleting" },
          { "id": "no", "label": "No, just delete" }
        ]
      }
    ]
  }
}
```

## LLM Tool Description (Token-Optimized)

For use as the tool description when registering with smaller or older LLMs:

```
ask_user_interview: Structured interview tool for collecting human input/approval before agent actions.

Actions:
- create: Create interview with questions. Returns interviewId.
- get: Poll interview status/responses by interviewId.
- submit: Submit user answers to a pending interview.

Question types: text, single_choice, multi_choice, number, confirm.

Interviews expire (default 3600s). States: pending → answered | expired.

Use ONLY for approval/clarification workflows. Do NOT use for general questions or data retrieval.

Create payload: { title?, taskRunId?, expiresInSeconds?, questions: [{ id, type, prompt, required?, options? }] }
Submit payload: { interviewId, responses: [{ questionId, value }] }
Get payload: { interviewId }
```
