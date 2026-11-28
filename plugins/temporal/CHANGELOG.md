# @kwkevinchan/backstage-plugin-temporal

## 0.1.0

### Minor Changes

- First release of the frontend plugin, for the legacy frontend system
  (`.`) and the new one (`./alpha`). It needs the backend plugin
  `@kwkevinchan/backstage-plugin-temporal-backend`; without it the pages say
  that the backend does not serve the Temporal plugin and name that package.

  - A **Temporal** entity tab with the workflows of an entity (annotations,
    the `TemporalWorkflow` kind and `spec.dependsOn`), a **Temporal** page
    (`/temporal`) with the **Workflows** and **Executions** tabs, and cards
    for `TemporalWorkflow` entities: summary and related workflows. The tab
    of a `TemporalWorkflow` entity shows the numbers of its recent runs.
  - Workflow details around a step graph (React Flow with the dagre layout),
    with a panel for the selected step and tabs for the steps, a timeline,
    the events and the details. The tab and the selected step are in the URL.
  - The operations that change workflows: Signal, Update, Cancel, Terminate
    and Rerun on the details page, Start workflow above the workflow lists,
    and Pause or Resume and Run now on schedules, with buttons for custom
    backend actions. Signals, updates and queries described in
    `spec.messages` with an `inputSchema` get a form. The buttons show
    nothing when `temporal.control.enabled` is false.
  - Extension points for other plugins and app modules: `temporalApiRef`,
    `TemporalWorkflowActionBlueprint`, `TemporalWorkflowListActionBlueprint`,
    `TemporalScheduleActionBlueprint`, `TemporalWorkflowSectionBlueprint` and
    `TemporalControlActionBlueprint` (`./alpha`), and the `workflowActions`,
    `workflowListActions`, `scheduleActions` and `workflowSections` props and
    `createTemporalControlActionDef()` for the legacy system. `./common` has
    the permissions, the API types and the annotation constants; `./ui`
    (alpha) has the building blocks of the pages for the companion packages
    of this plugin.
  - Experimental, no compatibility promise: the model calls and tool calls of
    the official Temporal AI integrations (the LLM panel) and Temporal Event
    Groups (group frames in the graph and the **Event Groups** tab).
