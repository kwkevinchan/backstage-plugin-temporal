---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

The in-house loop boxes, the **Loops** tab and
`temporal.experimental.aiWorkflows` are removed. There is no compatibility
layer.

Removed:

- the Loops tab and `TemporalApi.getWorkflowLoops`
- graph nodes of `type: 'loop'` (the collapsed/expanded in-house loop box
  and per-round frames)
- graph fields `loop` and `loops`

Use Temporal Event Groups for group frames around a loop, and the LLM
panel with the official Temporal AI integration adapters (`vercel-ai-sdk`,
`openai-agents`) for model calls.
