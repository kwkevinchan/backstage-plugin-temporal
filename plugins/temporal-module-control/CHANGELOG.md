# @kwkevinchan/backstage-plugin-temporal-module-control

## 0.1.0

### Minor Changes

- fd16b97: First release of the frontend control module, with the backend control
  module: Signal, Update, Cancel, Terminate and Rerun on the workflow details
  page, Start workflow above the workflow lists, and buttons for custom
  backend actions (`TemporalControlActionBlueprint` in `./alpha`,
  `createTemporalControlActionDef()` for the legacy system). Its client is
  `temporalControlApiRef`. Without this module the pages only read. Signals
  and updates described in `spec.messages` with an `inputSchema` get a form
  (`@rjsf/core`); the others a JSON field filled with their example.
  Schedules get Pause or Resume and Run now (`temporal.workflow.start`,
  recorded with the auditor).

### Patch Changes

- Updated dependencies [14a8792]
- Updated dependencies [e819b25]
- Updated dependencies [234d30b]
  - @kwkevinchan/backstage-plugin-temporal-common@0.1.0
  - @kwkevinchan/backstage-plugin-temporal@0.1.0
