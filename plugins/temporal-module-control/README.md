# @kwkevinchan/backstage-plugin-temporal-module-control

Frontend module of the unofficial [Backstage Temporal plugin](../../README.md)
with the buttons and dialogs that change workflows: **Signal…**,
**Update…**, **Cancel**, **Terminate** and **Rerun** on the workflow details
page, **Start workflow** above the workflow lists, and buttons for custom
backend actions. It calls the routes of the backend module
[`@kwkevinchan/backstage-plugin-temporal-backend-module-control`](../temporal-backend-module-control/README.md);
install both, or neither to keep the plugin read-only. **Query…** is in the
core plugin.

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-module-control
```

## New frontend system

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal/alpha';
import temporalControlModule from '@kwkevinchan/backstage-plugin-temporal-module-control/alpha';

export default createApp({
  features: [temporalPlugin, temporalControlModule /* ... */],
});
```

The module has three extensions, which can be disabled or configured in
`app.extensions` like any other:

| Extension                                      | What it adds                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `api:temporal/control`                         | The client of the control routes (`temporalControlApiRef`).           |
| `temporal-workflow-action:temporal/controls`   | Signal, Update, Cancel, Terminate and Rerun on the details page.      |
| `temporal-workflow-list-action:temporal/start` | Start workflow on `TemporalWorkflow` entities and the Workflows page. |

A button for a custom action of the backend (added with
`temporalControlExtensionPoint.addControlAction()`):

```ts
import { TemporalControlActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal-module-control/alpha';

TemporalControlActionBlueprint.make({
  name: 'escalate',
  params: {
    actionId: 'escalate',
    label: 'Escalate',
    confirm: 'Raise the priority to high?',
    // Optional: disables the button without the permission.
    permission: temporalWorkflowUpdatePermission,
    filter: workflow => workflow.status === 'Running',
  },
});
```

## Legacy frontend system

```tsx
import {
  createTemporalControlActionDef,
  temporalControlApiFactory,
  temporalControlListActions,
  temporalControlWorkflowActions,
} from '@kwkevinchan/backstage-plugin-temporal-module-control';

// apis.ts, optional: without it the buttons use the default client
export const apis = [/* ... */ temporalControlApiFactory];

const workflowActions = [
  ...temporalControlWorkflowActions,
  createTemporalControlActionDef({ actionId: 'escalate', label: 'Escalate' }),
];

<EntityTemporalContent
  workflowActions={workflowActions}
  workflowListActions={temporalControlListActions}
/>;
<TemporalPage
  workflowActions={workflowActions}
  workflowListActions={temporalControlListActions}
/>;
```

## Configuration

The Signal and Update dialogs offer only these names when they are set (the
backend module rejects other names):

```yaml
temporal:
  control:
    allowedSignals: [addNote, close]
    allowedUpdates: [setPriority]
```

## Permissions

Each button is disabled, with the reason as a tooltip, when the user does
not have its permission on the workflow's entity: `temporal.workflow.start`,
`.signal`, `.update`, `.cancel`, `.terminate` and `.rerun`. The backend
checks them again.
