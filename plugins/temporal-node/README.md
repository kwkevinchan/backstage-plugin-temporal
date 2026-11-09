# @kwkevinchan/backstage-plugin-temporal-node

Node library of the unofficial [Backstage Temporal plugin](../../README.md),
for backend modules:

- `temporalServiceRef`: a root-scoped service with one shared Temporal
  connection, configured under `temporal.connection` (address, namespaces,
  `auth` with `none` or `bearer`). It gives a `Client` per namespace.
- `temporalExtensionPoint`: `addWorkflowEnricher()` adds data to workflow
  summaries; `addControlAction()` adds a custom workflow action.

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { temporalExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-node';

export default createBackendModule({
  pluginId: 'temporal',
  moduleId: 'my-enricher',
  register(env) {
    env.registerInit({
      deps: { temporal: temporalExtensionPoint },
      async init({ temporal }) {
        temporal.addWorkflowEnricher({
          id: 'my-enricher',
          async enrich(items) {
            return items;
          },
        });
      },
    });
  },
});
```

The permissions and types are in
[`@kwkevinchan/backstage-plugin-temporal-common`](../temporal-common).

## Versions

The `Client` handed to modules comes from `@temporalio/client` (1.24). A new
major version of `@temporalio/client` is a new major version of this package.
