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

| Entry point | Exports                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`         | Default: a feature loader with the plugin, the default factory of its access service and the catalog module. Named: `temporalPlugin`, `catalogModuleTemporalWorkflowKind`, to add them one by one; `temporalPlugin` needs `temporalAccessServiceFactory` (`./alpha`) or a factory of your own for `temporalAccessServiceRef` next to it.                                                                 |
| `./node`    | `temporalServiceRef`: a root-scoped service with one shared Temporal connection (`temporal.connection`: address, namespaces, `tls`, `auth` with `none` or `bearer`; only `@temporalio/client` is used).                                                                                                                                                                                                  |
| `./alpha`   | `temporalAccessServiceRef` (the access checks of the plugin) and `temporalAccessServiceFactory`, `temporalControlExtensionPoint` (custom actions: `addControlAction()`), `temporalWorkflowEnricherExtensionPoint` (`addWorkflowEnricher()`; it only adds enrichers), `temporalWorkflowPermissionResourceRef`, `temporalWorkflowConditions` and `createTemporalWorkflowConditionalDecision` for policies. |
| `./common`  | The permissions (`temporalPermissions`, `temporalWorkflowReadPermission` and the others) for permission policies, the annotation constants, the `TemporalWorkflow` kind (schema and type guards) and the types and paths of the API.                                                                                                                                                                     |

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
`searchAttribute` (both lists: a Bool search attribute that must be true);
`limit` (stats, default 50, at most 100); `pageSize`, `pageToken` (history);
`entityRef` on every route under `.../workflows/:workflowId[/runs/:runId]`
and on the schedule operations. On a workflow route, `entityRef` names the
entity the permission is checked on, and the workflow must belong to it
(404 otherwise). Without it, `temporal.workflow.list` (with
`temporal.workflow.history.list` for history, steps, model calls and
downloads) allows the workflows it covers; when it does not, the entity
comes from the `searchAttributes.entityRef` search attribute.

The routes that change one workflow (signal, update, cancel, terminate,
rerun, custom actions) and query first load the workflow with the read
checks above (`temporal.workflow.read` on the entity, or
`temporal.workflow.list` without `entityRef`), then check their own
permission on the workflow's entity: a caller with `temporal.workflow.signal`
but without read access gets 403.

Bodies are JSON: `{ name, args }` for signal, update and query (`args` is
the list of arguments), `{ reason }` for terminate, `{ workflowId? }` for
rerun, `{ workflowType?, taskQueue?, args?, workflowId? }` for start (plus
`namespace` on `/workflows`). Update, query and actions answer `{ result }`;
start and rerun answer the new `{ namespace, workflowId, runId }`. Signal,
update, cancel and terminate answer 409 when the workflow is not running;
start and rerun when the workflow ID is taken; the schedule operations when
Temporal refuses the operation in the state of the schedule; custom actions
when the action does not apply to the workflow. The routes that change
workflows (signal, update, cancel, terminate, rerun, start, custom actions
and the schedule operations) do not exist when `temporal.control.enabled` is
false: they answer 404 without a body, like the definition route without the
Zigflow backend module. Errors of the routes that exist have the JSON error
body of the Backstage backend. Query and `GET .../handlers` (the
signals, updates and queries a running workflow defines) are always served:
a query needs `temporal.workflow.query`, the handler list only the read
permission. The schedule operations take `?entityRef=` (the schedule must
start one of the entity's workflow types) or, without it, need the
permission without conditions; pause and unpause take an optional body
`{ "note": "..." }`.

### OpenAPI spec

[`src/schema/openapi.yaml`](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal-backend/src/schema/openapi.yaml),
published with the package, describes this API in OpenAPI 3.1: the
parameters, bodies and responses of every route and the error body. The
paths are relative to `/api/temporal`. Extension fields list the permissions a
route checks (`x-temporal-permissions`), the routes that
`temporal.control.enabled: false` removes (`x-temporal-control`), the
experimental routes (`x-temporal-experimental`; they and the experimental
fields change before the first stable release) and the definition route of
the Zigflow backend module (`x-temporal-module`). The tests of the routes
check their requests and responses against it (the binary payload download
excepted).

To show it in the catalog, register an `API` entity that reads the file of
the version you run. Replace `main` with the commit SHA of that release, not
its tag: the tags (`@kwkevinchan/backstage-plugin-temporal-backend@<version>`)
contain slashes, and the GitHub URL reader takes the first segment after
`blob/` as the ref.

```yaml
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: temporal-backend
  title: Temporal backend API
spec:
  type: openapi
  lifecycle: experimental
  owner: group:default/team-a
  definition:
    $text: https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal-backend/src/schema/openapi.yaml
```

The plugin does not serve the spec at `/api/temporal/openapi.json`, so the
catalog module `@backstage/plugin-catalog-backend-module-backstage-openapi`
does not find it.
