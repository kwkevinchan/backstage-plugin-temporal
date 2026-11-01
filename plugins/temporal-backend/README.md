# @kwkevinchan/backstage-plugin-temporal-backend

Unofficial Backstage backend plugin for [Temporal](https://temporal.io).
Serves a read-only API under `/api/temporal`:

| Method | Path                                                                 | Permission                       |
| ------ | -------------------------------------------------------------------- | -------------------------------- |
| GET    | `/entities/:kind/:namespace/:name/workflows`                         | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]`         | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/history` | `temporal.workflow.history.read` |

Query parameters: `status`, `pageSize`, `pageToken` (list); `entityRef`
(details and history; without it the entity comes from the
`searchAttributes.entityRef` search attribute); `pageSize`, `pageToken`
(history).

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
```

See the [repository README](../../README.md) for configuration.
