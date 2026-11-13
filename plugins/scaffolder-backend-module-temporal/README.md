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
also installs that package's dependencies, such as `@temporalio/client` and
the AWS SDK; it does not start the Temporal plugin. Starting, signals and updates need its
operations: when `temporal.control.enabled` is false there, `start` and
`signal` fail with a message that names that key, and `wait` keeps working.
A task
started with service credentials (not by a user) runs as that service, and
permission policies usually allow services everything. The user's token
lasts about an hour from when the task is created, so `wait` is limited to
3600 seconds.

## Actions

| Action                     | Input                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Output                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `temporal:workflow:start`  | `entityRef`, or `workflowType` and `taskQueue` (and `namespace`); `workflowId`, `args`                                                                                                                                                                                                                                                                                                                                                                       | `namespace`, `workflowId`, `runId`, `workflowUrl` |
| `temporal:workflow:wait`   | `workflowId`, `runId`, `namespace`, `entityRef`; `untilSearchAttribute` (a Bool search attribute that ends the wait when true), `timeoutSeconds` (600), `intervalSeconds` (5; the pause before the second look, doubled after each look), `maxIntervalSeconds` (30; the longest pause, equal to `intervalSeconds` for a fixed interval; a larger `intervalSeconds` wins), `failIfNotCompleted` (true), `includeResult` (false; needs the history permission) | `status`, `runId`, `searchAttributes`, `result`   |
| `temporal:workflow:signal` | `workflowId`, `runId`, `namespace`, `entityRef`; `kind` (`signal` or `update`), `name`, `args`                                                                                                                                                                                                                                                                                                                                                               | `result` (of an update)                           |

`args` is an array of arguments, or one value for one argument. Without a
`namespace`, `start` uses the namespace of the entity or the default of the
Temporal backend plugin, and `wait` and `signal` use that default: the
`temporal.connection.defaultNamespace` (`default` when it is not set), read
from the app-config of the backend that runs the Scaffolder, so it must be
the same there when the Temporal plugin runs in another backend. Pass the
`namespace` output of `start` to `wait` and `signal` for a workflow in another
namespace. Starting, signals and updates are kept in a checkpoint, so a retried
task does not start or send them again. Dry runs start and send nothing.

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
