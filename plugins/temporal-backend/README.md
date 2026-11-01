# @kwkevinchan/backstage-plugin-temporal-backend

Unofficial Backstage backend plugin for [Temporal](https://temporal.io).
Serves a read-only API under `/api/temporal`:

| Method | Path                                                                 | Permission                       |
| ------ | -------------------------------------------------------------------- | -------------------------------- |
| GET    | `/workflows`                                                         | `temporal.workflow.list`         |
| GET    | `/entities/:kind/:namespace/:name/workflows`                         | `temporal.workflow.read`         |
| GET    | `/entities/:kind/:namespace/:name/workflow-stats`                    | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]`         | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/history` | `temporal.workflow.history.read` |

Query parameters: `status`, `pageSize`, `pageToken`, `allRuns` (lists;
without `allRuns=true` or a `status`, runs that continued as new are left out,
so a workflow that keeps continuing as new is listed once); `namespace`,
`workflowType`, `workflowId` (start of the workflow ID) on `/workflows`;
`limit` (stats, default 50, at most 100); `entityRef` (details and history;
without it, `temporal.workflow.list` allows any workflow, otherwise the entity
comes from the `searchAttributes.entityRef` search attribute); `pageSize`,
`pageToken` (history). Details, history and steps also accept
`temporal.workflow.list` when no `entityRef` is given.

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
```

See the [repository README](../../README.md) for configuration.
