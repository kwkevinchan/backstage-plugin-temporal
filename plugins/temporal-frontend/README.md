# @kwkevinchan/backstage-plugin-temporal-frontend

Unofficial Backstage frontend plugin for [Temporal](https://temporal.io).

## Purpose

Shows Temporal workflows next to the catalog entities that own them: a
**Temporal** tab with the workflow executions and their progress, a details page with
the step graph, a **Timeline** tab (steps on a time axis), events and details, queries,
schedules, cards for
`TemporalWorkflow` entities (one entity is one workflow type and its
definition) and a **Workflows** page. Works with the legacy
and the new frontend system of Backstage 1.56. The **Definition** tab for
workflows written in YAML (Zigflow) is a separate package,
[`@kwkevinchan/backstage-plugin-temporal-module-zigflow`](../temporal-module-zigflow/README.md).
Experimental and off by default (backend config
`temporal.experimental.aiWorkflows`; it will move to a separate package, no
compatibility promise): the loops of AI workflows and the LLM steps of agent
workflows. The buttons that start, signal, update, cancel, terminate and
rerun workflows, run custom backend actions, and pause, resume and run
schedules come with the plugin; they show nothing when
`temporal.control.enabled` is false (the backend then serves none of those
routes).

## Installation

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-frontend
```

It needs the backend plugin
[`@kwkevinchan/backstage-plugin-temporal-backend`](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal-backend/README.md):
without it the pages show an error that says the backend does not serve the
Temporal plugin and names that package. This package does not depend on the
backend package; it carries its own copy of the shared definitions in
`./common`.
See the [repository README](https://github.com/kwkevinchan/backstage-plugin-temporal#readme) for the setup of both frontend systems and
the configuration.

## API

New frontend system (`@kwkevinchan/backstage-plugin-temporal-frontend/alpha`):
the default export is the plugin, with the entity content, the Workflows
page, the entity cards, the API and the buttons of the operations
(`temporal-workflow-action:temporal/controls`,
`temporal-workflow-list-action:temporal/start` and
`temporal-schedule-action:temporal/controls`). To turn the operations off,
set `temporal.control.enabled: false`. Disable the three button extensions in
`app.extensions` only to remove individual buttons. The plugin's extensions
are not exported by name; to change one, use
`plugin.getExtension('page:temporal').override(...)` with
`plugin.withOverrides(...)` (see
[Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending)
in the repository README). Besides the plugin, `./alpha` exports
`TemporalWorkflowActionBlueprint`, `TemporalWorkflowListActionBlueprint`,
`TemporalScheduleActionBlueprint`, `TemporalWorkflowSectionBlueprint` and
`TemporalControlActionBlueprint`.

Legacy frontend system:

| Export                                                                                | What it is                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `temporalPlugin`                                                                      | The plugin.                                             |
| `EntityTemporalContent`                                                               | Entity tab: workflow executions and details.            |
| `TemporalPage`                                                                        | Workflows page: the workflow executions of a namespace. |
| `EntityTemporalWorkflowSummaryCard`                                                   | Workflow type card of a `TemporalWorkflow` entity.      |
| `EntityTemporalRelatedWorkflowsCard`                                                  | Workflow types a component depends on.                  |
| `isTemporalAvailable`, `isTemporalWorkflowEntity`, `getDependsOnTemporalWorkflowRefs` | Conditions for entity pages.                            |
| `TemporalClient`                                                                      | Client of the backend API (`TemporalApi`).              |
| `createTemporalControlActionDef`                                                      | A button that runs a custom backend action.             |

`EntityTemporalContent` and `TemporalPage` show the buttons of the
operations first; the `workflowActions`, `workflowListActions` and
`scheduleActions` props add yours after them.

## Extension points

Plugins and app modules that add buttons or tabs to the workflow page, or
that call the Temporal backend from their own components, use these exports.

- `temporalApiRef`, `TemporalApi`: client of the backend plugin, with the
  workflow reads, queries and handler names, the operations that change
  workflows and custom backend actions.
- `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`,
  `TemporalWorkflowListActionDef`, `TemporalScheduleActionDef`: actions,
  tabs, list actions and schedule actions for the legacy frontend system
  (props `workflowActions`, `workflowSections`, `workflowListActions` and
  `scheduleActions` of `EntityTemporalContent` and `TemporalPage`).
- `useTemporalWorkflow()`: the workflow shown on the current page, as
  `TemporalWorkflowExtensionProps` (the props of the action components).
- `./alpha`: `TemporalWorkflowActionBlueprint`,
  `TemporalWorkflowListActionBlueprint`, `TemporalScheduleActionBlueprint`
  and `TemporalWorkflowSectionBlueprint` for the new frontend system, and
  `TemporalControlActionBlueprint` for a button of a custom backend action.
- `TemporalWorkflowListActionProps`, `TemporalScheduleActionProps`,
  `TemporalWorkflowExtensionProps`: props of the components of actions, list
  actions, schedule actions and sections.

The permissions, the annotation constants and the response types of the
backend API (`WorkflowDetail`, `WorkflowSummary` and the others) are in
`./common` (`@kwkevinchan/backstage-plugin-temporal-frontend/common`). `./ui`
has building blocks of the pages for companion packages such as the Zigflow
module (alpha, no compatibility promise).

Backstage's lint rule `@backstage/no-mixed-plugin-imports` warns when a
frontend plugin with another `pluginId` imports this package. Add the
extensions from an app module (`createFrontendModule`, as in
`packages/app-next`) or a frontend plugin module, or list this package in the
rule's `excludedTargetPackages`.

See [Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending) in the repository README for
examples.
