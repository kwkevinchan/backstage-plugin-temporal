# @kwkevinchan/backstage-plugin-temporal-node

Node library of the unofficial [Backstage Temporal plugin](../../README.md),
for backend modules:

- `temporalServiceRef`: a root-scoped service with one shared Temporal
  connection, configured under `temporal.connection` (address, namespaces,
  `auth` with `none` or `bearer`). It gives a `Client` per namespace.
- `temporalExtensionPoint`: `addWorkflowEnricher()` adds data to workflow
  summaries. Custom workflow actions use `temporalControlExtensionPoint`
  from `/alpha`, available with the control module.

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

## Access service (alpha)

`@kwkevinchan/backstage-plugin-temporal-node/alpha` exports
`temporalAccessServiceRef`: the checks the plugin runs before it reads or
changes a workflow (permission on the entity, namespace allowed, the
workflow belongs to the entity). The plugin and its modules share one
instance, so a module that serves its own routes under `/api/temporal` can
use the same checks:

```ts
const { context, workflow } = await access.loadWorkflow(ref, {
  entityRef,
  level: 'read',
  credentials: await httpAuth.credentials(req),
});
```

The default factory comes with the backend plugin. To decide access in
another way, add your own `createServiceFactory` for `temporalAccessServiceRef`
to the backend.

The permissions and types are in
[`@kwkevinchan/backstage-plugin-temporal-common`](../temporal-common).

## Versions

The `Client` handed to modules comes from `@temporalio/client` (1.24). A new
major version of `@temporalio/client` is a new major version of this package.
