# @kwkevinchan/backstage-plugin-scaffolder-module-temporal

Scaffolder form field of the unofficial [Backstage Temporal plugin](../../README.md):
`TemporalWorkflowPicker` lists workflows to choose from, for the template
actions of
[`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal`](../scaffolder-backend-module-temporal).
The workflows are listed with the permissions of the user filling in the
form. Needs the Temporal frontend plugin (its `temporalApiRef`).

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-scaffolder-module-temporal
```

New frontend system:

```ts
import temporalScaffolderModule from '@kwkevinchan/backstage-plugin-scaffolder-module-temporal/alpha';

export default createApp({ features: [/* ... */ temporalScaffolderModule] });
```

Legacy frontend system:

```tsx
import { ScaffolderFieldExtensions } from '@backstage/plugin-scaffolder-react';
import { TemporalWorkflowPickerFieldExtension } from '@kwkevinchan/backstage-plugin-scaffolder-module-temporal';

<Route path="/create" element={<ScaffolderPage />}>
  <ScaffolderFieldExtensions>
    <TemporalWorkflowPickerFieldExtension />
  </ScaffolderFieldExtensions>
</Route>;
```

## Options

```yaml
workflow:
  title: Release to approve
  type: string
  ui:field: TemporalWorkflowPicker
  ui:options:
    entityRef: temporalworkflow:default/release # or workflowType (and namespace)
    status: Running # the default; any for every status
    searchAttribute: ApprovalPending # only workflows where this Bool is true
```

Without `entityRef`, the workflows of the namespace are listed, which needs
`temporal.workflow.list`. The value is the workflow ID; at most the 50 newest
matching workflows are offered.
