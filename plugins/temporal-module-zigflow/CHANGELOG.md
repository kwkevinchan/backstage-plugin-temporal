# @kwkevinchan/backstage-plugin-temporal-module-zigflow

## 0.1.0

### Minor Changes

- First release of the Definition tab for workflows written in the
  Serverless Workflow DSL and run by Zigflow, a module of
  `@kwkevinchan/backstage-plugin-temporal`. On `TemporalWorkflow` entities
  with `spec.definition` it shows the YAML next to its graph, selecting each
  other, with a run of the workflow on top. It reads the file through the
  backend module `@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`;
  without it the tab says that the backend serves no workflow definitions.
  The package root exports `EntityTemporalDefinitionContent` for the legacy
  frontend system; the new frontend system uses `./alpha`.
