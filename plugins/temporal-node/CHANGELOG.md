# @kwkevinchan/backstage-plugin-temporal-node

## 0.1.0

### Minor Changes

- 97ea3de: First release of the node package, for backend modules:
  `temporalServiceRef` (the shared Temporal client, with bearer token
  authentication) and `temporalExtensionPoint` (workflow enrichers). The
  `./alpha` entry point has `temporalAccessServiceRef` (the access checks of the
  plugin, plugin-scoped and replaceable), `temporalWorkflowPermissionResourceRef`,
  `temporalControlExtensionPoint` (custom control actions) and the JSON
  payload helpers `encodeJsonPayloads` and `decodeJsonPayloads`. The package
  depends on `@temporalio/client` `~1.24.0`; while it is `0.x`, a new minor of
  the client is a new minor of this package. The connection can use TLS
  (`temporal.connection.tls`).

### Patch Changes

- Updated dependencies [14a8792]
  - @kwkevinchan/backstage-plugin-temporal-common@0.1.0
