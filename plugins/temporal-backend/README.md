# @kwkevinchan/backstage-plugin-temporal-backend

Unofficial Backstage backend plugin for [Temporal](https://temporal.io).
Serves an API under `/api/temporal` that reads workflows and, checked with
the permission framework and recorded with the auditor, changes them:

| Method | Path                                                                                | Permission                       |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| GET    | `/workflows`                                                                        | `temporal.workflow.list`         |
| GET    | `/entities/:kind/:namespace/:name/workflows`                                        | `temporal.workflow.read`         |
| GET    | `/entities/:kind/:namespace/:name/workflow-stats`                                   | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]`                        | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/history`                | `temporal.workflow.history.read` |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/payloads/download?key=` | `temporal.workflow.history.read` |
| POST   | `/entities/:kind/:namespace/:name/workflows`                                        | `temporal.workflow.start`        |
| POST   | `/workflows`                                                                        | `temporal.workflow.start` + list |
| POST   | `.../workflows/:workflowId[/runs/:runId]/signal`                                    | `temporal.workflow.signal`       |
| POST   | `.../workflows/:workflowId[/runs/:runId]/update`                                    | `temporal.workflow.update`       |
| POST   | `.../workflows/:workflowId[/runs/:runId]/query`                                     | `temporal.workflow.read`         |
| POST   | `.../workflows/:workflowId[/runs/:runId]/cancel`                                    | `temporal.workflow.cancel`       |
| POST   | `.../workflows/:workflowId[/runs/:runId]/terminate`                                 | `temporal.workflow.terminate`    |
| POST   | `.../workflows/:workflowId[/runs/:runId]/rerun`                                     | `temporal.workflow.rerun`        |
| POST   | `.../workflows/:workflowId[/runs/:runId]/actions/:actionId`                         | the action's permission          |

Query parameters: `status`, `pageSize`, `pageToken`, `allRuns` (lists;
without `allRuns=true` or a `status`, runs that continued as new are left out,
so a workflow that keeps continuing as new is listed once); `namespace`,
`workflowType`, `workflowId` (start of the workflow ID) on `/workflows`;
`limit` (stats, default 50, at most 100); `entityRef` (details and history;
without it, `temporal.workflow.list` allows any workflow, otherwise the entity
comes from the `searchAttributes.entityRef` search attribute); `pageSize`,
`pageToken` (history). Details, history and steps also accept
`temporal.workflow.list` when no `entityRef` is given.

Bodies are JSON: `{ name, args }` for signal, update and query (`args` is
the list of arguments), `{ reason }` for terminate, `{ workflowId? }` for
rerun, `{ workflowType?, taskQueue?, args?, workflowId? }` for start (plus
`namespace` on `/workflows`). Update, query and actions answer `{ result }`;
start and rerun answer the new `{ namespace, workflowId, runId }`. Signal,
update, cancel and terminate answer 409 when the workflow is not running.
`temporal.control.enabled: false` turns every route that changes workflows
off (404); `temporal.control.allowedSignals` and `allowedUpdates` limit the
names (400 for others).

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
```

Payloads stored in S3 by `@kwkevinchan/temporal-payload-s3` are shown when
`temporal.payloads.s3` is configured, and downloaded through
`payloads/download` (only keys of claim checks in that run's history). See the
[repository README](../../README.md) for configuration.
