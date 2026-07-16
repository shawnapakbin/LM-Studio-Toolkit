# Preloaded Skills

These JSON files are bundled with the LLM Toolkit and automatically seeded into the skills database on first run.

## Included Skills

| # | Skill | Category |
|---|-------|----------|
| 01 | skill-creation | Meta |
| 02 | deep-research | Knowledge |
| 03 | document-ingestion | Knowledge |
| 04 | research-paper-compilation | Content |
| 05 | summarize-archive | Knowledge |
| 06 | knowledge-graph-update | Knowledge |
| 07 | source-evaluation | Knowledge |
| 08 | code-review | Code |
| 09 | refactor-plan | Code |
| 10 | test-generation | Code |
| 11 | debug-workflow | Code |
| 12 | task-decomposition | Planning |
| 13 | decision-matrix | Planning |
| 14 | risk-assessment | Planning |
| 15 | technical-writing | Content |
| 16 | changelog-generation | Content |
| 17 | explain-concept | Content |
| 18 | data-exploration | Data |
| 19 | comparative-analysis | Data |
| 20 | self-improvement-log | Meta |
| 21 | prompt-engineering | Meta |
| 22 | tool-discovery | Meta |

## JSON Schema

Each skill file follows this structure:

```json
{
  "name": "kebab-case-name",
  "description": "What the skill does",
  "paramSchema": {
    "type": "object",
    "properties": {
      "param_name": { "type": "string", "description": "..." }
    },
    "required": ["param_name"]
  },
  "steps": [
    { "type": "prompt", "template": "Text with {{param_name}} placeholders" },
    { "type": "tool_call", "tool": "tool_name", "args": { "key": "{{param_name}}" } }
  ]
}
```

## User Skills

User-created skills are stored as Markdown in the `user/` sibling directory.
See the template in `user/` for the expected format.
