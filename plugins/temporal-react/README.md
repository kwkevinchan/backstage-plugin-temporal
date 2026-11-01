# @kwkevinchan/backstage-plugin-temporal-react

Frontend extension points of the unofficial Backstage Temporal plugin. Plugins
that extend the workflow page depend on this package only.

- `temporalApiRef`, `TemporalApi`: client of the backend plugin.
- `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`: actions and cards
  for the legacy frontend system (props of `EntityTemporalContent`).
- `useTemporalWorkflow()`: the workflow shown on the current page.
- `./alpha`: `TemporalWorkflowActionBlueprint` and
  `TemporalWorkflowSectionBlueprint` for the new frontend system.
