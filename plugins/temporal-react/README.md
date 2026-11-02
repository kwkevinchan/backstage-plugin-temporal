# @kwkevinchan/backstage-plugin-temporal-react

Frontend extension points of the unofficial Backstage Temporal plugin.

## Purpose

Plugins that add buttons or tabs to the workflow page, or that call the
Temporal backend from their own components, depend on this package only, not
on the frontend plugin itself.

## Installation

```sh
yarn --cwd plugins/your-plugin add @kwkevinchan/backstage-plugin-temporal-react
```

## API

- `temporalApiRef`, `TemporalApi`: client of the backend plugin, with the
  workflow reads and operations (start, signal, update, query, cancel,
  terminate, rerun, custom actions).
- `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`: actions and tabs
  for the legacy frontend system (props `workflowActions` and
  `workflowSections` of `EntityTemporalContent` and `TemporalPage`).
- `createTemporalControlActionDef()`: a button that runs a custom backend
  action, for the legacy frontend system.
- `useTemporalWorkflow()`, `TemporalWorkflowProvider`: the workflow shown on
  the current page.
- `temporalWorkflowExtensionsApiRef`: the shared mount point of actions and
  sections.
- `./alpha`: `TemporalWorkflowActionBlueprint` (with a `loader` or a
  `controlAction`) and `TemporalWorkflowSectionBlueprint` for the new
  frontend system.

See [Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending) in the repository README for
examples.
