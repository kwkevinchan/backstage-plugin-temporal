---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

The in-house loop format, the in-house LLM format and the
`temporal.experimental.aiWorkflows` setting are removed. There is no
compatibility layer.

Removed:

- the private package `@kwkevinchan/temporal-workflow-kit` (`/loop`, `/llm`)
- reading activity IDs of the form `loop/<name>/<round>/<step>`, the
  `temporal.loops` memo and the `__loop_state` query
- `GET .../loops` and the graph fields `loop` and `loops`
- the built-in LLM adapter `temporal-workflow-kit` (activity IDs
  `llm/<call>` and `tool/<call>/<toolCallId>`, result key `temporal.llm`)
- the config key `temporal.experimental.aiWorkflows`

Use Temporal Event Groups for loop frames in the graph, and the official
Temporal AI integration adapters (`vercel-ai-sdk`, `openai-agents`) with
the LLM panel for model calls. Other frameworks still register through
`temporalLlmAdapterExtensionPoint` (`TemporalLlmAdapter`).
