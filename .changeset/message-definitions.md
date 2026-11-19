---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

Rename `GET .../handlers` to `GET .../message-definitions`, and the exported types `WorkflowHandler` and `WorkflowHandlersResponse` to `WorkflowMessageDefinition` and `WorkflowMessageDefinitionsResponse` (breaking). The path helper, the merge function, `TemporalApi.getWorkflowHandlers` and `WorkflowQueries.handlers()` are renamed to match. Upgrade the backend and the frontend plugin together: they only talk over HTTP. The response fields (`signals`, `updates`, `queries`) are unchanged.
