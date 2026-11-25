# @kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal

Scaffolder actions of the unofficial [Backstage Temporal plugin](../../README.md):
templates can start a Temporal workflow, wait for it, and send it a signal or
an update. Pick a workflow in the form with the `TemporalWorkflowPicker`
field from
[`@kwkevinchan/backstage-plugin-scaffolder-module-temporal`](../scaffolder-module-temporal).

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal
```

```ts
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(
  import('@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal'),
);
```

The actions call the routes of the Temporal backend plugin **as the user who
runs the template**, so its permission checks, audit records and search
attributes (`entityRef`, `initiator`) apply as when the user uses the pages.
The Temporal backend plugin can run in another backend; the actions reach
it through the discovery service and only over HTTP. The module depends on
the whole backend package `@kwkevinchan/backstage-plugin-temporal-backend`
(for its shared definitions), so a backend that runs only the Scaffolder
also installs that package's dependencies, such as `@temporalio/client`; it
does not start the Temporal plugin. Starting, signals and updates need its
operations: when `temporal.control.enabled` is false there, `start` and
`signal` fail with a message that names that key, and `wait` keeps working.
A task
started with service credentials (not by a user) runs as that service, and
permission policies usually allow services everything. The user's token
lasts about an hour from when the task is created, so `wait` is limited to
3600 seconds.

## Actions

| Action                     | Input                                                                                                                                                                                                                                                                                                                                                                                                                          | Output                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `temporal:workflow:start`  | `entityRef`, or `workflowType` and `taskQueue` (and `namespace`); `workflowId`, `args`                                                                                                                                                                                                                                                                                                                                         | `namespace`, `workflowId`, `runId`, `workflowUrl` |
| `temporal:workflow:wait`   | `workflowId`, `runId`, `namespace`, `entityRef`; `untilSearchAttribute` (a Bool search attribute that ends the wait when true), `timeoutSeconds` (600), `intervalSeconds` (5; the pause before the second look, doubled after each look), `maxIntervalSeconds` (30; the longest pause, equal to `intervalSeconds` for a fixed interval; a larger `intervalSeconds` wins), `failIfNotCompleted` (true), `includeResult` (false) | `status`, `runId`, `searchAttributes`, `result`   |
| `temporal:workflow:signal` | `workflowId`, `runId`, `namespace`, `entityRef`; `kind` (`signal` or `update`), `name`, `args`                                                                                                                                                                                                                                                                                                                                 | `result` (of an update), `runId`                  |

`args` is an array of arguments, or one value for one argument. `start` with
an `entityRef` uses the namespace of the entity (the `temporal.io/namespace`
annotation, or `spec.namespace` of a `TemporalWorkflow`) and ignores the
`namespace` input; without an `entityRef` it uses `namespace`, else the
default. `wait` and `signal` use `namespace`; without it the namespace of the
`entityRef`; without either the default. The default is the one of the
Temporal backend plugin, `temporal.connection.defaultNamespace` (`default`
when it is not set), read from the app-config of the backend that runs the
Scaffolder, so it must be the same there when the Temporal plugin runs in
another backend.
When the two differ, the default of the Scaffolder backend is sent to the
Temporal backend, which answers according to its own settings: `400` when that
namespace is not in `temporal.connection.namespaces` there, `404` when an
`entityRef` is given and the workflow is not found in that namespace, and, when
both namespaces are allowed and no `entityRef` is given, and a workflow with the
same ID exists in the other namespace, `wait` and `signal` reach that one
instead.

The routes of the Temporal plugin that read or change a workflow name its
run. Without `runId`, `wait` and `signal` look up the latest run in the run
list of the workflow ID (the running run, else the one that closed last, as
the user who runs the template). A workflow that has just started can take a
moment to be listed: `wait` looks again until its timeout, `signal` fails. After
a `start`, pass its `runId` output: when the workflow ID was used before, the
list can still show the earlier run first, and `wait` would report that run.
The run list needs `temporal.workflow.list` (with conditions that cover the
run) when no `entityRef` is given, and with `entityRef` it does not include
child workflows: pass `runId` in both cases. `wait` follows a run that continued as new
to the run it continued as and outputs the run it ended on. `signal` outputs
the run it sent to; when the run it looked up continued as new before the
signal arrived (a 409 that names the run it continued as), it sends once more
to that run. A given `runId` is never replaced. For `kind: update` the `runId`
only locates the execution chain; the update acts on the run of the chain that
is currently running.

`wait` and `signal` read the entity from the catalog as the user who runs the
template; an entity that cannot be read is an error, not the default
namespace. Pass the `namespace` output of `start` to `wait` and `signal`: it
saves that read and cannot differ from where the workflow runs. Because
`temporal:workflow:wait` writes `searchAttributes` and (when `includeResult` is
true) `result` to Scaffolder task outputs, access to those outputs depends on
Scaffolder task permissions rather than Temporal's
`temporal.workflow.read` permission (see the
[Security section](../../README.md#security)). Starting,
signals and updates are kept in a checkpoint, so a retried task does not start
or send them again. When `workflowId` is omitted on `temporal:workflow:start`,
the action builds a default ID from the workflow type (or entity name), the
Scaffolder task ID, and the step ID (`<workflow>-<taskId>-<stepId>`), and starts
it with `workflowIdReusePolicy: REJECT_DUPLICATE`. Even if that workflow has
already closed before a task retry runs again (for instance, before the
checkpoint was saved), Temporal refuses to reuse the ID and the action fails
with a conflict stating that the workflow ID has already been run. Passing an
explicit `workflowId` keeps Temporal's default workflow ID reuse policy. Dry runs
start and send nothing.

## Example

```yaml
parameters:
  - title: Release
    properties:
      service:
        type: string
steps:
  - id: start
    action: temporal:workflow:start
    input:
      entityRef: temporalworkflow:default/release
      args:
        service: ${{ parameters.service }}
  - id: pending
    action: temporal:workflow:wait
    input:
      workflowId: ${{ steps.start.output.workflowId }}
      runId: ${{ steps.start.output.runId }}
      namespace: ${{ steps.start.output.namespace }}
      untilSearchAttribute: ApprovalPending
output:
  links:
    - title: Release workflow
      url: ${{ steps.start.output.workflowUrl }}
```

Approving it from another template:

```yaml
parameters:
  - title: Approve a release
    required: [workflow]
    properties:
      workflow:
        title: Release
        type: string
        ui:field: TemporalWorkflowPicker
        ui:options:
          entityRef: temporalworkflow:default/release
          searchAttribute: ApprovalPending
steps:
  - id: approve
    action: temporal:workflow:signal
    input:
      workflowId: ${{ parameters.workflow }}
      kind: update
      name: approve
      args:
        approved: true
        by: ${{ user.ref }}
```

`workflowUrl` links to the Workflows page of the frontend plugin
(`/temporal/...` under `app.baseUrl`).

## Notify when a decision is needed

After `wait` returns because `untilSearchAttribute` is true, a later step can
send a Backstage notification with a link to the run. The
`notification:send` action is from the official package
[`@backstage/plugin-scaffolder-backend-module-notifications`](https://github.com/backstage/backstage/tree/master/plugins/scaffolder-backend-module-notifications)
(install that module and `@backstage/plugin-notifications-backend`, and the
notifications frontend page). A complete template is in
[`examples/templates/release-with-notification.yaml`](../../examples/templates/release-with-notification.yaml).

```yaml
steps:
  - id: start
    action: temporal:workflow:start
    input:
      entityRef: temporalworkflow:default/release
      args:
        service: ${{ parameters.service }}
  - id: pending
    action: temporal:workflow:wait
    input:
      workflowId: ${{ steps.start.output.workflowId }}
      runId: ${{ steps.start.output.runId }}
      namespace: ${{ steps.start.output.namespace }}
      untilSearchAttribute: ApprovalPending
  - id: notify
    action: notification:send
    input:
      recipients: entity
      entityRefs:
        - ${{ parameters.notifyEntityRef }}
      title: A release is waiting for approval
      info: Open the workflow to approve or reject it.
      link: ${{ steps.start.output.workflowUrl }}
      severity: high
```

This only works while the template is still running:

- `wait` can run for at most 3600 seconds (the user's token expires). If it
  times out, the notification step does not run.
- Only the first decision point is covered. Later approvals happen after the
  template has finished, so this step cannot notify for them.
- The recipients are whatever the template writes: a fixed entity, or a
  parameter such as `notifyEntityRef` above.

For a long approval, or for later decision points, do not keep the template
waiting. Have the workflow itself send the notification when it reaches that
point, from an activity that calls the Backstage notifications API. That is
your workflow code, not this plugin. The plugin does not watch Temporal in
the background to send notifications.

The official usage guide shows an external caller creating a notification
with `POST /api/notifications` and a bearer token
([Notifications usage](https://backstage.io/docs/notifications/usage)).
Configure a static token under `backend.auth.externalAccess` and send it in
the `Authorization` header
([Service-to-service auth: Static Tokens](https://backstage.io/docs/auth/service-to-service-auth#static-tokens)).
In `@backstage/plugin-notifications-backend@0.6.10` (Backstage 1.56),
`POST /api/notifications` is a deprecated alias of
`POST /api/notifications/notifications`; both work in that version, and the
latter is the current path. A minimal activity:

```ts
await fetch(`${backstageBaseUrl}/api/notifications/notifications`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.BACKSTAGE_NOTIFICATIONS_TOKEN}`,
  },
  body: JSON.stringify({
    recipients: { type: 'entity', entityRef: 'group:default/team' },
    payload: {
      title: 'A release is waiting for approval',
      description: 'Open the workflow to approve or reject it.',
      link: workflowUrl,
      severity: 'high',
    },
  }),
});
```

The token is a Backstage service credential (a static token, or another
service-to-service method from that same auth document). It is not the token
of the user who started the workflow.
