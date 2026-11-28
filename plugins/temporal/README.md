# @kwkevinchan/backstage-plugin-temporal

Unofficial Backstage frontend plugin for [Temporal](https://temporal.io).

## Purpose

Shows Temporal workflows next to the catalog entities that own them: a
**Temporal** tab with the workflow executions and their progress, a details page with
the step graph, a **Timeline** tab (steps on a time axis), events and details, queries,
schedules, cards for
`TemporalWorkflow` entities (one entity is one workflow type and its
definition) and a **Temporal** page. Works with the legacy
and the new frontend system of Backstage 1.56. The **Definition** tab for
workflows written in YAML (Zigflow) is a separate package,
[`@kwkevinchan/backstage-plugin-temporal-module-zigflow`](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal-module-zigflow/README.md).
Model calls and tool calls of the official Temporal AI integrations are shown
in the graph with an LLM panel (experimental shape). The buttons that start, signal, update, cancel, terminate and
rerun workflows, run custom backend actions, and pause, resume and run
schedules come with the plugin; they show nothing when
`temporal.control.enabled` is false (the backend then serves none of those
routes).

## Installation

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal
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

New frontend system (`@kwkevinchan/backstage-plugin-temporal/alpha`):
the default export is the plugin, with the entity content, the Temporal
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

The legacy system uses the main entry point (`.`) and the new one `./alpha`.
Both show the same pages and read the same shared extensions, but they differ
in the extension ID and how duplicates are handled, in the error and loading
boundary of an extension, in the check of a section title, in the frame of the
Temporal page, and in the order and the custom `id` of actions. See [Entry
points and the two frontend
systems](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#entry-points-and-the-two-frontend-systems)
in the repository README.

Legacy frontend system:

| Export                                                                                | What it is                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `temporalPlugin`                                                                      | The plugin.                                        |
| `EntityTemporalContent`                                                               | Entity tab: workflow executions and details.       |
| `TemporalPage`                                                                        | Temporal page: Workflows and Executions tabs.      |
| `EntityTemporalWorkflowSummaryCard`                                                   | Workflow type card of a `TemporalWorkflow` entity. |
| `EntityTemporalRelatedWorkflowsCard`                                                  | Workflow types a component depends on.             |
| `isTemporalAvailable`, `isTemporalWorkflowEntity`, `getDependsOnTemporalWorkflowRefs` | Conditions for entity pages.                       |
| `TemporalClient`                                                                      | Client of the backend API (`TemporalApi`).         |
| `createTemporalControlActionDef`                                                      | A button that runs a custom backend action.        |

`EntityTemporalContent` and `TemporalPage` show the buttons of the
operations first; the `workflowActions`, `workflowListActions` and
`scheduleActions` props add yours after them.

## Extension points

Plugins and app modules that add buttons or tabs to the workflow page, or
that call the Temporal backend from their own components, use these exports.

- `temporalApiRef`, `TemporalApi`: client of the backend plugin, with the
  workflow reads, queries and message definition names, the operations that change
  workflows and custom backend actions. New methods come in minor versions;
  to replace the API, extend `TemporalClient` rather than implement every
  method.
- `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`,
  `TemporalWorkflowListActionDef`, `TemporalScheduleActionDef`: actions,
  tabs, list actions and schedule actions for the legacy frontend system
  (props `workflowActions`, `workflowSections`, `workflowListActions` and
  `scheduleActions` of `EntityTemporalContent` and `TemporalPage`).
- `TemporalWorkflowListActionProps`, `TemporalScheduleActionProps`,
  `TemporalWorkflowExtensionProps`: props of the components of actions, list
  actions, schedule actions and sections. The workflow of the details page
  comes as `TemporalWorkflowExtensionProps` (`workflow`, `reload`,
  `workflowHref`); to test a component, render it with these props.

The permissions, the annotation constants and the response types of the
backend API (`WorkflowDetail`, `WorkflowSummary` and the others) are in
`./common` (`@kwkevinchan/backstage-plugin-temporal/common`). `./ui`
has building blocks of the pages for companion packages such as the Zigflow
module (alpha: a change that breaks them comes in a minor version while the
plugin is `0.x`, never in a patch).

Backstage's lint rule `@backstage/no-mixed-plugin-imports` warns when a
frontend plugin with another `pluginId` imports this package. Add the
extensions from an app module (`createFrontendModule`, as in
`packages/app-next`) or a frontend plugin module, or list this package in the
rule's `excludedTargetPackages`.

See [Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending) in the repository README for
examples.
