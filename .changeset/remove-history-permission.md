---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend-module-actions': patch
---

Whoever may read a workflow sees all of it. `temporal.workflow.read` (on the entity) and `temporal.workflow.list` (without one) cover the event history, the inputs and results, the whole failures and the records of model calls; there is no separate permission for them. To limit who sees the contents of workflows, limit who may read them, with a policy on `temporal.workflow.read`.

- `temporal-backend`: `GET /:wf/history`, `GET /:wf/result` and `GET /:wf/llm-calls/:eventId` check the read permission. The step graph always has the inputs and results. `WorkflowGraphResponse` and `WorkflowDetail` lose their flags for left-out contents. The access service of `./alpha` loses its method that decided whether the caller may see the contents, and `loadWorkflow` its access level option. The documentation of `WorkflowHistoryEvent` describes the payloads the history returns (`DecodedPayload`).
- `temporal-frontend`: the step drawer, the model call panel and the events tab show the inputs, results, records and the raw history to whoever may read the workflow.
- `scaffolder-backend-module-temporal`: `temporal:workflow:wait` with `includeResult` needs the read permission only.
- `temporal-backend-module-actions`: `get-workflow` returns the messages of the causes of a failure to whoever may read the workflow.
