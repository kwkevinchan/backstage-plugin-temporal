---
'@kwkevinchan/temporal-workflow-kit': minor
---

First release of the helpers for Temporal workers, in two entry points.
Large payloads are left to Temporal External Storage (the SDKs' own
`ExternalStorage` and S3 driver), which the Backstage plugin reads.

- `@kwkevinchan/temporal-workflow-kit/loop`: loop markers for the rounds of
  generate, check and revise loops, the `temporal.loops` memo, the
  `__loop_state` query and continue-as-new helpers. Runs in the workflow
  sandbox and needs `@temporalio/workflow` (an optional peer dependency).
- `@kwkevinchan/temporal-workflow-kit/llm`: activity ID markers for model
  calls and their tool calls, `recordLlmCall()` that records a model call
  with the OpenTelemetry GenAI attributes (version `gen-ai-dev/1.42.0-dev`:
  messages, reasoning, tool calls, tokens, duration, errors), and converters
  for OpenAI chat completions, Anthropic messages and Ollama chat. Needs no
  LLM SDK.
