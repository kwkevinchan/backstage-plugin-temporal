# @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow

## 0.1.0

### Minor Changes

- f0c4f30: First release of the backend module for Zigflow workflows: it serves the
  definition file of a `TemporalWorkflow` entity
  (`GET /api/temporal/entities/:kind/:namespace/:name/definition`), read with
  the URL reader of the configured integrations, at most
  `temporal.definitions.maxBytes` (1 MiB), parsed as plain YAML with a limit
  on aliases, with the lines of each task. For `format: source` definitions it
  serves the file with its language and the lines of the workflow's function.

### Patch Changes

- Updated dependencies [14a8792]
  - @kwkevinchan/backstage-plugin-temporal-common@0.1.0
