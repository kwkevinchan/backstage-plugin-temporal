# @kwkevinchan/backstage-plugin-scaffolder-module-temporal

## 0.1.0

### Minor Changes

- a1e4961: First release of the Scaffolder modules. The backend module adds the template
  actions `temporal:workflow:start`, `temporal:workflow:wait` (until the
  workflow closes, or until a Bool search attribute is true, polling less
  often the longer it waits, up to `maxIntervalSeconds`) and
  `temporal:workflow:signal` (signals and updates). They call the Temporal
  backend plugin as the user who runs the template; when its operations are
  turned off (`temporal.control.enabled: false`), `start` and `signal` fail
  with a message that says so. `wait` and `signal` run in the namespace of
  their `entityRef` when no `namespace` is given (as `start` does), reading the
  entity from the catalog as that user; an entity that cannot be read is an
  error. The frontend module (it needs
  `@kwkevinchan/backstage-plugin-temporal-frontend`) adds the
  `TemporalWorkflowPicker` form field, which lists workflows by entity, type,
  status and a Bool search attribute.

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
