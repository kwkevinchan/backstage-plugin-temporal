# @kwkevinchan/backstage-plugin-temporal-react

Frontend extension points of the unofficial Backstage Temporal plugin. Plugins
that extend the workflow page depend on this package only.

- `temporalApiRef`, `TemporalApi`: client of the backend plugin, with the
  workflow operations (start, signal, update, query, cancel, terminate,
  rerun, custom actions).
- `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`: actions and cards
  for the legacy frontend system (props of `EntityTemporalContent`).
- `createTemporalControlActionDef()`: a button that runs a custom backend
  action, for the legacy frontend system.
- `useTemporalWorkflow()`: the workflow shown on the current page.
- `./alpha`: `TemporalWorkflowActionBlueprint` and
  `TemporalWorkflowSectionBlueprint` for the new frontend system;
  `TemporalWorkflowActionBlueprint` takes a `loader` or a `controlAction`
  (a button that runs a custom backend action).
