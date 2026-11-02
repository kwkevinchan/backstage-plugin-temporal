---
'@kwkevinchan/temporal-workflow-kit': minor
---

First release of the helpers for Temporal workers, in three entry points.

- `@kwkevinchan/temporal-workflow-kit/s3`: a payload codec that stores
  payloads larger than a threshold (default 128 KiB) in S3-compatible
  storage and keeps a claim check (`json/claim-check`) with the bucket, key,
  size, SHA-256, encoding and media type in the history, and
  `createS3DataConverter()` for workers and clients. Needs
  `@aws-sdk/client-s3` (an optional peer dependency).
- `@kwkevinchan/temporal-workflow-kit/loop`: loop markers for the rounds of
  generate, check and revise loops, the `temporal.loops` memo, the
  `__loop_state` query and continue-as-new helpers. Runs in the workflow
  sandbox and needs `@temporalio/workflow` (an optional peer dependency),
  not the AWS SDK.
- `@kwkevinchan/temporal-workflow-kit/llm`: activity ID markers for model
  calls and their tool calls, `recordLlmCall()` that records a model call
  with the OpenTelemetry GenAI attributes (version `gen-ai-dev/1.42.0-dev`:
  messages, reasoning, tool calls, tokens, duration, errors), and converters
  for OpenAI chat completions, Anthropic messages and Ollama chat. Needs no
  LLM SDK.
