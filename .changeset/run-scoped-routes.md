---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': minor
---

**Breaking:** the routes of one workflow name its run. `GET /namespaces/:namespace/workflows/:workflowId` lists the runs of the workflow ID (a `WorkflowListResponse`, with `pageSize`, `pageToken` and `entityRef`), and every route that reads or changes a run is under `/namespaces/:namespace/workflows/:workflowId/runs/:runId` (details, history, steps, graph, progress, model calls, handlers, query, signal, update, cancel, terminate, rerun and custom actions). The routes without the run are gone. Upgrade the backend and the frontend plugin together: they only talk over HTTP.

- The run list applies the permission check of the list to every run: with `entityRef`, `temporal.workflow.read` on the entity and only its runs (the entity must be in the namespace of the path); without it, `temporal.workflow.list` and its conditions. A workflow ID with a quote, a backslash or a control character cannot be listed (400).
- `./common`: `buildWorkflowPath` builds the path of the run list; `buildWorkflowRunPath` and the new `WorkflowRunRef` type name one run. `buildWorkflowOperationPath`, `buildWorkflowActionPath` and `buildWorkflowHandlersPath` take a `WorkflowRunRef`, and so does `TemporalAccessService.loadWorkflow`.
- Scaffolder: `temporal:workflow:wait` and `temporal:workflow:signal` look up the latest run in the run list when `runId` is not given. `wait` follows a run that continued as new to the run it continued as; `signal` outputs `runId`, the run it sent to.
