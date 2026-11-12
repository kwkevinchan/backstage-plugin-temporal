# @kwkevinchan/backstage-plugin-catalog-backend-module-temporal

## 0.1.0

### Minor Changes

- e819b25: First release of the catalog module: the `TemporalWorkflow` kind
  (`temporal.io/v1alpha1`), validated with its schema, with the relations of
  its owner, system and `spec.dependsOn`. `spec.definition` (`format`,
  `target`) points at the YAML of a workflow written in the Serverless Workflow
  DSL.

### Patch Changes

- Updated dependencies [14a8792]
  - @kwkevinchan/backstage-plugin-temporal-common@0.1.0
