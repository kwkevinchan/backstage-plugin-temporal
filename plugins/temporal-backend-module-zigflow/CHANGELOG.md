# @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow

## 0.1.0

### Minor Changes

- First release of the backend module for workflows written in the
  Serverless Workflow DSL and run by Zigflow, a module of
  `@kwkevinchan/backstage-plugin-temporal-backend`. It serves the definition
  file of a `TemporalWorkflow` entity (`spec.definition`) for the Definition
  tab of `@kwkevinchan/backstage-plugin-temporal-module-zigflow`:
  `GET /api/temporal/entities/:kind/:namespace/:name/definition`, with the
  `temporal.workflow.read` permission on the entity. The file is read with
  the URL reader of the configured integrations, within the limits of
  `temporal.definitions` (size, cache, concurrent reads and reads per
  minute). A relative `spec.definition.target` stays in the repository of
  the entity file; an absolute URL needs a `temporal.definitions.allow`
  entry.
