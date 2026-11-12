# @kwkevinchan/backstage-plugin-temporal-backend

Unofficial Backstage backend plugin for [Temporal](https://temporal.io).

## Purpose

The core of the plugin, for the Backstage backend:

- an API under `/api/temporal` that reads workflows, their history, graph,
  schedules and large payloads, and operates them (start, signal, update,
  query, cancel, terminate, rerun, custom actions, and pause, resume and run
  now on schedules), each checked with the permission framework and the
  operations recorded with the auditor;
- the `TemporalWorkflow` catalog kind;
- for other backend code: the shared Temporal client, the extension points
  for modules, and the permissions and types.

The frontend plugin
[`@kwkevinchan/backstage-plugin-temporal-frontend`](https://github.com/kwkevinchan/backstage-plugin-temporal/tree/main/plugins/temporal-frontend)
uses the API and does not work without this package; this package works
without the frontend.

> **Security.** The operations that change workflows are on by default.
> Without a permission policy (the allow-all policy), every signed-in user
> may start, cancel and terminate workflows. `temporal.control.allowedSignals`
> and `allowedUpdates` only limit the names of signals and updates; they do
> not stop cancel or terminate. Restrict the operations with a permission
> policy, or turn them off:
>
> ```yaml
> temporal:
>   control:
>     enabled: false
> ```
>
> See [Permissions](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#permissions)
> and [Workflow controls](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#workflow-controls).

## Installation

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend
```

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
```

It needs the catalog and the permission framework, and
`temporal.connection` in the app config. Allow the kind in the catalog
rules to use `TemporalWorkflow` entities. In a backend without the catalog
plugin the catalog module is skipped. Payloads that workers store in S3
with Temporal External Storage are shown when `temporal.externalStorage.s3`
is configured; allow `blob:` in `backend.csp.img-src` for their image
thumbnails. See the [repository README](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md) for the configuration and the
permission policy.

The backend reads the External Storage references and the S3 objects behind
them with its own code and the AWS SDK; it does not depend on the
experimental driver packages of the Temporal SDK or on the workflow kit (a
worker package).

## Exports

| Entry point | Exports                                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`         | Default: a feature loader with the plugin, the default factory of its access service and the catalog module. Named: `temporalPlugin`, `catalogModuleTemporalWorkflowKind`, `TemporalWorkflowEntityProcessor`, to add them one by one.                                                                                              |
| `./node`    | `temporalServiceRef`: a root-scoped service with one shared Temporal connection (`temporal.connection`: address, namespaces, `tls`, `auth` with `none` or `bearer`; only `@temporalio/client` is used), with `DefaultTemporalService` and `readTemporalServiceOptions`. `temporalExtensionPoint`: `addWorkflowEnricher()`.         |
| `./alpha`   | `temporalAccessServiceRef` (the access checks of the plugin) and `temporalAccessServiceFactory`, `temporalControlExtensionPoint` (custom actions), `temporalWorkflowPermissionResourceRef`, `temporalWorkflowConditions` and `createTemporalWorkflowConditionalDecision` for policies, `encodeJsonPayloads`, `decodeJsonPayloads`. |
| `./common`  | The permissions (`temporalPermissions`, `temporalWorkflowReadPermission` and the others) for permission policies, the annotation constants, the `TemporalWorkflow` kind (schema and type guards) and the types and paths of the API.                                                                                               |

`./node`, `./alpha` and `./common` do not load the plugin itself. A module
that imports this package gets a warning from the Backstage lint rule
`@backstage/no-mixed-plugin-imports`; it does not fail the lint. See
[Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending)
in the repository README for examples.

## API

| Method | Path                                                                                   | Permission                                    |
| ------ | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| GET    | `/workflows`                                                                           | `temporal.workflow.list`                      |
| GET    | `/entities/:kind/:namespace/:name/workflows`                                           | `temporal.workflow.read`                      |
| GET    | `/schedules`                                                                           | `temporal.workflow.list` (without conditions) |
| GET    | `/entities/:kind/:namespace/:name/schedules`                                           | `temporal.workflow.read`                      |
| GET    | `/entities/:kind/:namespace/:name/workflow-stats`                                      | `temporal.workflow.read`                      |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]`                           | `temporal.workflow.read`                      |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/history`                   | `temporal.workflow.history.read`              |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/steps`                     | `temporal.workflow.history.read`              |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/graph`                     | `temporal.workflow.read`                      |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/progress`                  | `temporal.workflow.read`                      |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/loops` (experimental)      | `temporal.workflow.read`                      |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/llm-calls/:eventId` (exp.) | `temporal.workflow.history.read`              |
| GET    | `/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/payloads/download?key=`    | `temporal.workflow.history.read`              |
| GET    | `.../workflows/:workflowId[/runs/:runId]/handlers`                                     | `temporal.workflow.read`                      |
| POST   | `.../workflows/:workflowId[/runs/:runId]/query`                                        | `temporal.workflow.query` + read              |

The routes that change workflows, unless `temporal.control.enabled` is
false:

| Method | Path                                                        | Permission                       |
| ------ | ----------------------------------------------------------- | -------------------------------- |
| POST   | `/entities/:kind/:namespace/:name/workflows`                | `temporal.workflow.start`        |
| POST   | `/workflows`                                                | `temporal.workflow.start` + list |
| POST   | `.../workflows/:workflowId[/runs/:runId]/signal`            | `temporal.workflow.signal`       |
| POST   | `.../workflows/:workflowId[/runs/:runId]/update`            | `temporal.workflow.update`       |
| POST   | `.../workflows/:workflowId[/runs/:runId]/cancel`            | `temporal.workflow.cancel`       |
| POST   | `.../workflows/:workflowId[/runs/:runId]/terminate`         | `temporal.workflow.terminate`    |
| POST   | `.../workflows/:workflowId[/runs/:runId]/rerun`             | `temporal.workflow.rerun`        |
| POST   | `.../workflows/:workflowId[/runs/:runId]/actions/:actionId` | the action's permission          |
| POST   | `/namespaces/:namespace/schedules/:scheduleId/pause`        | `temporal.workflow.start`        |
| POST   | `/namespaces/:namespace/schedules/:scheduleId/unpause`      | `temporal.workflow.start`        |
| POST   | `/namespaces/:namespace/schedules/:scheduleId/trigger`      | `temporal.workflow.start`        |

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
The routes that change workflows (signal, update, cancel, terminate, rerun,
start, custom actions and the schedule operations) do not exist when
`temporal.control.enabled` is false (404). Query and `GET .../handlers` (the
signals, updates and queries a running workflow defines) are always served:
a query needs `temporal.workflow.query`, the handler list only the read
permission. The schedule operations take `?entityRef=` (the schedule must
start one of the entity's workflow types) or, without it, need the
permission without conditions; pause and unpause take an optional body
`{ "note": "..." }`.
