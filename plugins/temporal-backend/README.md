# @kwkevinchan/backstage-plugin-temporal-backend

Unofficial Backstage backend plugin for [Temporal](https://temporal.io).

## Purpose

Serves an API under `/api/temporal` that reads workflows and, checked with
the permission framework and recorded with the auditor, changes them. The
frontend plugin `@kwkevinchan/backstage-plugin-temporal` uses it.

## Installation

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend
```

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
```

It needs the catalog and the permission framework, and
`temporal.connection` in the app config. Payloads that workers store in S3
with Temporal External Storage are shown when `temporal.externalStorage.s3`
is configured; allow `blob:` in `backend.csp.img-src` for their image
thumbnails. See the [repository README](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md) for the configuration and the
permission policy.

The backend reads the External Storage references and the S3 objects behind
them with its own code and the AWS SDK; it does not depend on the
experimental driver packages of the Temporal SDK or on the workflow kit (a
worker package).

## Exports

- The default export is the plugin.
- `temporalServiceRef`: root-scoped service with one shared Temporal
  connection, configured under `temporal.connection` (address, namespaces,
  `auth` with `none` or `bearer`). Only `@temporalio/client` is used.
- `temporalExtensionPoint`: `addWorkflowEnricher()` adds data to workflow
  summaries; `addControlAction()` adds a custom workflow action, served as
  `POST .../actions/:actionId` and checked with its own permission.
- The permissions (`temporalPermissions`, `temporalWorkflowReadPermission`
  and the others) for permission policies, the annotation constants, the
  `TemporalWorkflow` kind (schema and type guards) and the response types of
  the API.

Backstage's lint rule `@backstage/no-mixed-plugin-imports` warns when a
backend module imports a backend plugin. For a module that uses
`temporalExtensionPoint`, list this package in the rule's
`excludedTargetPackages`, as `plugins/catalog-backend-module-temporal` does.
See [Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending)
in the repository README for an example.

## API

| Method | Path                                                                                | Permission                       |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| GET    | `/workflows`                                                                        | `temporal.workflow.list`         |
| GET    | `/entities/:kind/:namespace/:name/workflows`                                        | `temporal.workflow.read`         |
| GET    | `/entities/:kind/:namespace/:name/workflow-stats`                                   | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]`                        | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/history`                | `temporal.workflow.history.read` |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/steps`                  | `temporal.workflow.history.read` |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/graph`                  | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/progress`               | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/loops`                  | `temporal.workflow.read`         |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/llm-calls/:eventId`     | `temporal.workflow.history.read` |
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
