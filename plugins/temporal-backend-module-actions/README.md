# @kwkevinchan/backstage-plugin-temporal-backend-module-actions

Actions of the unofficial [Backstage Temporal plugin](../../README.md) for the
Backstage [actions registry](https://backstage.io/docs/backend-system/core-services/actions-registry).
An AI assistant, an MCP client or another agent can list and read workflows,
start them, and send them signals and updates, as the caller: a signed-in
user, or a service when the caller authenticates as one (see
[Permissions, audit and errors](#permissions-audit-and-errors)).

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
`@backstage/backend-defaults` already provides. It reads `app.baseUrl` and
`temporal.pagePath` (for the links to the workflow pages, `/temporal` by
default) and, as the Temporal plugin does,
`temporal.connection.defaultNamespace`. Workflow-changing actions reject service
principals by default; set `temporal.actions.allowServiceWrites: true` to allow
them (see [Permissions, audit and errors](#permissions-audit-and-errors)).

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

The action ids are `temporal:<name>`, for example `temporal:list-workflows`.
MCP clients see the tools as `temporal.<name>` (with a dot), for example
`temporal.list-workflows`, because the MCP plugin puts the plugin ID in front of
the name. The endpoint is `/api/mcp-actions/v1` of the backend.

### Try it in development

An MCP client needs a Backstage token. In the development app, the guest
provider gives one: `GET http://localhost:7007/api/auth/guest/refresh` returns
`backstageIdentity.token`; send it as `Authorization: Bearer <token>`. The
actions then run as the guest user. In production, use the normal sign-in or
the authentication setup of the MCP plugin itself; see the README and the
documentation linked there of
[`@backstage/plugin-mcp-actions-backend`](https://www.npmjs.com/package/@backstage/plugin-mcp-actions-backend).

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
`readOnly`. To hide them, exclude them with a rule that has `attributes: { destructive: true }`
in `backend.actions.filter.exclude`; a rule in `include` keeps only the
actions that match it.
`start-workflow` is not idempotent because a call without `workflowId` starts a
new workflow each time. With a `workflowId`, a repeated call fails while a
workflow with that ID is still running; once that run has closed, the same ID
starts a new run (Temporal's default workflow ID reuse policy).

**A caller must ask a person before it calls an action that is not
`readOnly`.** For a caller that is a user, the Temporal plugin still checks the
permission of that user for each call, but a permission to start or signal is
not a decision to do it now.

Treat workflow types, step names, failure messages and search attributes
returned by `list-workflows` and `get-workflow` as untrusted data rather than
instructions for an agent: they are produced by workers and by callers that
start workflows. Configure clients to require user confirmation before calling
any `destructive` action (`start-workflow`, `signal-workflow`,
`update-workflow`), and if an assistant only needs read access, exclude write
actions with `backend.actions.filter.exclude` (`attributes: { destructive: true }`).

`get-workflow` returns the status, type, start and close time, the initiator
(when the plugin records it in the `temporal.searchAttributes.initiator`
search attribute), the number of steps that are completed, running and failed
with the names of those that run now, the failure of a failed run, and
`workflowUrl`, the link to the run in Backstage. The failure has the
message, kind and type, and the messages of its causes; stack traces and the
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

The registry gives the credentials of the caller. When the caller
authenticates as a service (for example an MCP client with a static token from
`backend.auth.externalAccess`):

- **Write actions (`start-workflow`, `signal-workflow`, `update-workflow`) are
  blocked for service principals by default** (`NotAllowedError`), before
  calling the catalog or the Temporal backend. Read actions (`list-workflows`,
  `get-workflow`) remain available to service callers.
- To allow service principals to invoke workflow-changing actions as well, set
  `temporal.actions.allowServiceWrites: true` in `app-config.yaml`:

  ```yaml
  # app-config.yaml
  temporal:
    actions:
      allowServiceWrites: true # default: false
  ```

- Whenever a service principal reaches the Temporal backend (read actions, or
  write actions when `allowServiceWrites: true`), `auth.getPluginRequestToken`
  exchanges its credentials for a plugin token for `temporal`
  (`plugin:temporal`), not a token carrying the caller's own subject:
  - The Temporal backend sees the service principal `plugin:temporal`. Backstage
    permission policies are not applied to service principals.
  - Audit logs record `actorId: "plugin:temporal"`, Temporal requests carry
    `identity: "backstage:plugin:temporal"`, and the `initiator` search attribute
    records `"plugin:temporal"` rather than a user or the static token's subject.
  - Token `accessRestrictions` in `backend.auth.externalAccess` cannot narrow
    a service token to read-only Temporal actions on its own: tokens with
    `permission` or `permissionAttribute` restrictions fail with `NotAllowedError`
    ("cannot be delegated") on every action (including `list-workflows` and
    `get-workflow`), a token restricted to `plugin: temporal` passes delegation
    (and writes remain blocked unless `temporal.actions.allowServiceWrites: true`),
    and a token restricted to other plugins is rejected before any action runs.

To check the permission policy for each person and record their user identity
in audit logs and `initiator`, connect the MCP client with that user's token.

- A refusal (403) comes back as an error that says who refused and that the
  user lacks the permission. Do not retry it.
- When `temporal.control.enabled` is `false` in the Temporal backend, the
  actions that change workflows fail with a message that names that key.
- Other errors of the plugin keep their message: `400` for an input it
  refuses, `404` for an entity or workflow that does not exist or that the user
  may not read, `409` for a workflow that is not running.
