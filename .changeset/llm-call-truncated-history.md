---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Forward `truncated` from `readEvents` to `buildWorkflowGraphWithLlm` in `AiWorkflowQueries.llmCall` and return a `404` message explaining that history was truncated when a requested model call `eventId` lies beyond the 5,000-event read limit.
