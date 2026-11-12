# @kwkevinchan/backstage-plugin-temporal-module-zigflow

## 0.1.0

### Minor Changes

- f0c4f30: First release of the Definition tab for workflows written in the Serverless
  Workflow DSL and run by Zigflow: on `TemporalWorkflow` entities with
  `spec.definition`, the YAML next to its graph, selecting each other, with a
  run of the workflow on top (done, running, failed, not reached); the YAML
  and the graph can go full screen together. With `format: source`, a
  workflow written in code shows its source code with its function (`symbol`,
  else the workflow type) marked. It needs the Temporal plugin
  (`@kwkevinchan/backstage-plugin-temporal`) and the backend module
  `@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`.

### Patch Changes

- Updated dependencies [14a8792]
- Updated dependencies [e819b25]
- Updated dependencies [234d30b]
  - @kwkevinchan/backstage-plugin-temporal-common@0.1.0
  - @kwkevinchan/backstage-plugin-temporal@0.1.0
