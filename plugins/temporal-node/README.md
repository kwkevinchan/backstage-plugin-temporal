# @kwkevinchan/backstage-plugin-temporal-node

Node.js library of the unofficial Backstage Temporal plugin.

- `temporalServiceRef`: root-scoped service with one shared Temporal
  connection, configured under `temporal.connection` (address, namespaces;
  `auth` is reserved for authentication, only `none` today).
- `temporalExtensionPoint`: `addWorkflowEnricher()` adds data to workflow
  summaries; `addControlAction()` is defined for custom workflow actions and
  is not served yet.

Only `@temporalio/client` is used.
