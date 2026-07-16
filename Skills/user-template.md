---
name: my-custom-skill
description: A template for creating user skills in markdown format
---

## Parameters
- topic (string, required): The main subject to work on
- depth (string): Level of detail: 'brief', 'standard', 'detailed'

## Steps
1. [prompt] Analyze the following topic: {{topic}} at depth level: {{depth}}
2. [prompt] Produce a structured output based on the analysis above.
3. [tool_call:memory] {"action": "store", "label": "{{topic}}", "content": "result"}
