---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Breaking: backend modules can no longer add LLM adapters. The model calls and tool calls of the official Temporal AI integrations (Vercel AI SDK and OpenAI Agents SDK) are read as before, by the two built-in adapters.

Removed from `./alpha` (7 of 28 exports): `temporalLlmAdapterExtensionPoint`, `TemporalLlmAdapterExtensionPoint`, `TemporalLlmAdapter`, `TemporalLlmStep`, `TemporalLlmStepPayloads`, `TemporalLlmModelCall` and `TemporalLlmToolStep`. A module that registers an adapter no longer starts: the extension point does not exist.

Removed with it, since only a module's adapter could use them:

- local activities are no longer read as tool calls;
- a step reads as one model call, not several: `WorkflowLlmSummary.call` and `callCount`, `WorkflowLlmCallResponse.call`, `index`, `callCount` and `fromFailure`, and the `?index=` parameter of `GET .../llm-calls/:eventId`;
- tools that ran inside the model call's activity: `WorkflowLlmRecord.toolExecutions`, `WorkflowLlmToolExecution` (removed from `./common`, 117 to 116 exports) and `WorkflowLlmToolCallRef.inActivity`;
- `WorkflowToolLink.call`.

Also removed because no adapter fills them: `operation` (of `WorkflowLlmRecord` and `WorkflowLlmSummary`), `WorkflowLlmRecord.conversationId` and `startTime`, and `WorkflowLlmMessage.finishReason`.
