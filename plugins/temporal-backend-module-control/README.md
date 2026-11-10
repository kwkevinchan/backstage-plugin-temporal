# @kwkevinchan/backstage-plugin-temporal-backend-module-control

Module of the unofficial [Backstage Temporal plugin](../../README.md) that
changes workflows: start, signal, update, cancel, terminate, rerun, and
custom actions. Without it the backend plugin only reads.

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend-module-control
```

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-control'),
);
```

Every operation is checked with the permission framework through the
plugin's access service (`temporalAccessServiceRef`) and recorded with the
auditor. The permissions are `temporal.workflow.start`, `.signal`,
`.update`, `.cancel`, `.terminate` and `.rerun`, on the catalog entity of the
workflow.

## Schedules

`POST /namespaces/:namespace/schedules/:scheduleId/pause`, `/unpause` and
`/trigger` (optional body `{ "note": "..." }` for pause and unpause). They
need `temporal.workflow.start`: with `?entityRef=`, on that entity, and the
schedule must start one of its workflow types; without, the policy must
allow it without conditions.

## Configuration

```yaml
temporal:
  control:
    # Optional: names that may be sent. Empty or absent allows every name.
    allowedSignals: [addNote, close]
    allowedUpdates: [setPriority]
```

The operations use the shared connection of `temporal.connection`. A
separate connection for them will be configured under
`temporal.control.connection` when it is added.

## Custom actions

A backend module can add an action, served as `POST .../actions/:actionId`
and shown as a button by the frontend control module
([`-module-control`](../temporal-module-control/README.md)):

```ts
import { temporalControlExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-node/alpha';

reg.registerInit({
  deps: { control: temporalControlExtensionPoint },
  async init({ control }) {
    control.addControlAction({
      id: 'escalate',
      permission: temporalWorkflowUpdatePermission,
      filter: workflow => workflow.status === 'Running',
      async handle(ref, body, { client }) {
        const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
        return handle.executeUpdate('setPriority', { args: ['high'] });
      },
    });
  },
});
```
