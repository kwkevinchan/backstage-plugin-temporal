# @kwkevinchan/backstage-plugin-temporal-backend-module-actions

Actions of the unofficial [Backstage Temporal plugin](../../README.md) for the
Backstage [actions registry](https://backstage.io/docs/backend-system/core-services/actions-registry).
An AI assistant, an MCP client or another agent can list and read workflows,
start them, and send them signals and updates, as the signed-in user.

The module only registers the actions and sets their attributes. It does not
know about chat or approvals: the caller decides, from the attributes, when to
ask a person.

## Install

Install the module in the same backend as the Temporal backend plugin
([`@kwkevinchan/backstage-plugin-temporal-backend`](../temporal-backend)). Its
plugin ID is `temporal`, so it starts only in the backend that runs that
plugin.

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend-module-actions
```

```ts
// packages/backend/src/index.ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-actions'),
);
```

The module uses the actions registry service of Backstage (`@alpha` in
`@backstage/backend-plugin-api/alpha`), which `createBackend()` of
`@backstage/backend-defaults` already provides. It reads `app.baseUrl` (for the
links to the workflow pages) and, as the Temporal plugin does,
`temporal.connection.defaultNamespace`. There is no config of its own.

The module depends on the whole backend package
`@kwkevinchan/backstage-plugin-temporal-backend`, because it uses its client
(`/node`) and its shared definitions (`/common`); this does not start the
Temporal plugin.

## Expose the actions through MCP

Actions are available to other backend plugins through the actions service. To
serve them to MCP clients, install `@backstage/plugin-mcp-actions-backend` and
add `temporal` to `backend.actions.pluginSources`. Keep the sources that the
list already has:

```yaml
# app-config.yaml
backend:
  actions:
    pluginSources:
      - temporal
```

Every action then has the id `temporal:<name>`, for example
`temporal:list-workflows`. Follow the documentation of
`@backstage/plugin-mcp-actions-backend` for the endpoint and the sign-in of the
MCP client.

## Actions

| Action            | `readOnly` | `destructive` | `idempotent` | Does                                                                                                     |
| ----------------- | ---------- | ------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `list-workflows`  | yes        | no            | yes          | The most recent runs of an entity: `entityRef`; `status`, `limit` (10, at most 50)                       |
| `get-workflow`    | yes        | no            | yes          | One run: `workflowId`; `runId`, `namespace`, `entityRef`. Status, times, initiator, steps, failure, link |
| `start-workflow`  | no         | yes           | no           | Starts a workflow: `entityRef`, or `workflowType` and `taskQueue`; `namespace`, `workflowId`, `args`     |
| `signal-workflow` | no         | yes           | no           | Sends a signal: `workflowId`, `name`; `runId`, `namespace`, `entityRef`, `args`                          |
| `update-workflow` | no         | yes           | no           | Sends an update and returns its result: the same input as `signal-workflow`                              |

The attributes are static, so they describe the worst case of each call. The
actions that change workflows are `destructive` because the module does not
know what a started workflow, a signal or an update does in the workflow that
receives it; this is also the Backstage default for an action that is not
`readOnly`. A filter with `destructive: true` in `backend.actions.filter` hides
them.
`start-workflow` is not idempotent because a call without `workflowId` starts a
new workflow each time; give a `workflowId` to make a repeated call fail
instead of start a second workflow.

**A caller must ask a person before it calls an action that is not
`readOnly`.** The Temporal plugin still checks the permission of the user for
each call, but a permission to start or signal is not a decision to do it now.

`get-workflow` returns the status, type, start and close time, the initiator
(when the plugin records it in the `temporal.searchAttributes.initiator`
search attribute), the number of steps that are completed, running and failed
with the names of those that run now, the failure of a failed run, and
`workflowUrl`, the link to the run in Backstage. The failure always has
the message, kind and type. Its causes are there only when the user has the
history permission (`temporal.workflow.history.read`); stack traces and the
payloads of steps are never returned. The step counts use the step kinds that
the workflow pages count: activities, timers, child workflows, updates and
signals sent.

`signal-workflow` and `update-workflow` send only the names that the Temporal
plugin allows (`temporal.control.allowedSignals` and `allowedUpdates`; every
name when they are empty); a name that it refuses comes back as an error with
the reason.

Without `runId`, `get-workflow`, `signal-workflow` and `update-workflow` use
the latest run of the workflow ID. Without `namespace`, they use the namespace
of the entity in `entityRef`, else `temporal.connection.defaultNamespace`.
`list-workflows` returns the `namespace`, `workflowId` and `runId` to give.

### Not in this version

Cancel, terminate and rerun are not actions. They stay on the workflow page of
the Temporal plugin, where the user confirms them.

## Permissions, audit and errors

Each action calls the routes of the Temporal backend plugin with a token for
the user whose credentials the registry gives to the action
(`auth.getPluginRequestToken({ onBehalfOf, targetPluginId: 'temporal' })`).
The permission checks, audit records and search attributes (`entityRef`,
`initiator`) are those of the pages and of the Scaffolder actions. The module
never calls Temporal itself.

- A refusal (403) comes back as an error that says who refused and that the
  user lacks the permission. Do not retry it.
- When `temporal.control.enabled` is `false` in the Temporal backend, the
  actions that change workflows fail with a message that names that key.
- Other errors of the plugin keep their message: `400` for an input it
  refuses, `404` for an entity or workflow that does not exist or that the user
  may not read, `409` for a workflow that is not running.
