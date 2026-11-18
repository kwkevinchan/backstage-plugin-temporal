# @kwkevinchan/backstage-plugin-temporal-module-zigflow

## 0.1.0

### Minor Changes

- ac2997c: First release of the Definition tab for workflows written in the Serverless
  Workflow DSL and run by Zigflow. The frontend module (it needs
  `@kwkevinchan/backstage-plugin-temporal-frontend`) shows, on
  `TemporalWorkflow` entities with `spec.definition`, the YAML next to its
  graph, selecting each other, with a run of the workflow on top; with
  `format: source`, a workflow written in code shows its source with its
  function marked. The backend module (a module of
  `@kwkevinchan/backstage-plugin-temporal-backend`) serves the file
  (`GET /api/temporal/entities/:kind/:namespace/:name/definition`), read with
  the URL reader of the configured integrations, at most
  `temporal.definitions.maxBytes`. Without the backend module the tab says
  that the backend serves no workflow definitions. The frontend module's package
  root exports `EntityTemporalDefinitionContent` for the legacy frontend system;
  the new frontend system uses `./alpha`.

### Patch Changes

- Updated dependencies [769a54e]
- Updated dependencies [ab0d8a5]
- Updated dependencies [d03e8b6]
- Updated dependencies [ed6d8ea]
- Updated dependencies [1585ec4]
- Updated dependencies [fdcbd99]
- Updated dependencies [f19ec52]
- Updated dependencies [b799cab]
- Updated dependencies [b799cab]
- Updated dependencies [91ba7a2]
- Updated dependencies [82635e4]
- Updated dependencies [2fba3c5]
- Updated dependencies [e819b25]
- Updated dependencies [6e9d8e8]
- Updated dependencies [eb92912]
- Updated dependencies [65bbbf4]
- Updated dependencies [8712f0e]
- Updated dependencies [b7b17c4]
- Updated dependencies [b7b17c4]
- Updated dependencies [1cf2e47]
- Updated dependencies [24c643b]
  - @kwkevinchan/backstage-plugin-temporal-frontend@0.1.0
