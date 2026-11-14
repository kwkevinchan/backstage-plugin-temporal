---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

Model calls and tool calls of the official Temporal AI integrations are
shown without changing the worker: the Vercel AI SDK integration
(`@temporalio/vercel-ai-sdk`: `invokeModel`, `invokeModelStreaming`, MCP
tools) and the OpenAI Agents integration (`@temporalio/openai-agents`:
`invokeModelActivity`, `invokeModelStreamActivity`). A step is read as a
model call only when its payloads have the integration's shape; others stay
plain steps.

- Model calls no longer need `temporal.experimental.aiWorkflows`; the
  setting now only turns on the loops. So, in an installation that never
  turned it on, whoever has the read permission of a workflow now sees in
  the graph what the backend reads from the payloads of its model calls:
  the framework, the model, the token counts (also reasoning and cached),
  the finish reason, the names and tool call IDs of the tools asked for,
  and the type or message of an error. The messages, the thinking and
  tool arguments and results still need `temporal.workflow.history.read`.
  Without the history permission, the graph does not download the input
  of a model call from External Storage; the full record route does.
- `temporalLlmAdapterExtensionPoint` (`./alpha`) adds LLM adapters for other
  frameworks (`TemporalLlmAdapter`): adapters of modules are asked before
  the built-in ones, a taken ID fails the start, and an adapter that throws
  or returns something of the wrong shape (or not plain JSON, or more than
  100 calls for one step) makes that step a plain step with a warning in
  the log that names the adapter, the event and the error type, not the
  error message.
- Tool calls are linked to their model call by the tool call ID the step
  records, else by the tool name, arguments and order of the steps; such
  links are marked `inferred` (`WorkflowToolLink`, `WorkflowLlmToolCallRef`),
  and the frontend shows them as **Inferred link**.
- `WorkflowLlmSummary` and `WorkflowLlmCallResponse` have the `framework`
  that read the call; `call` is optional (the frontend titles a call by its
  summary or model without it). A step can make several model calls
  (`callCount`); `GET .../llm-calls/:eventId?index=` reads one of them.
- The format of the unreleased workflow kit is still read by an internal
  adapter.
