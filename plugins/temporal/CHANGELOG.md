# @kwkevinchan/backstage-plugin-temporal

## 0.1.0

### Minor Changes

- e819b25: First release of the frontend plugin, for the legacy and the new frontend
  system (`./alpha`).

  - An entity tab with the workflows of an entity (annotations, the
    `TemporalWorkflow` kind and `spec.dependsOn`), a Workflows page
    (`/temporal`), and cards for `TemporalWorkflow` entities: summary, recent
    run statistics and related workflows.
  - Workflow details around a step graph (React Flow with the dagre layout), a
    panel for the selected step, and tabs for the steps, a timeline, the
    events and the details. Large payloads stored in S3 show their size, a preview, a download
    button and a thumbnail of images.
  - Experimental, off unless the backend sets
    `temporal.experimental.aiWorkflows`, and to move to a separate package:
    loops of AI workflows (one box per loop, the Loops tab) and LLM steps
    (model and tool calls, the LLM panel).
  - A `./ui` entry point (alpha) with the building blocks of the pages (the
    graph canvas and its layout, status helpers, panels, the dialogs of
    workflow operations, the style class names) for companion packages such as
    `@kwkevinchan/backstage-plugin-temporal-module-zigflow` and `-module-control`.
  - Workflow lists keep their filters, page and page size in the URL, so a
    list can be bookmarked and the browser's back button returns to it.
  - `TemporalApi.listEntityWorkflows` and `listWorkflows` take a
    `searchAttribute` option: only workflows whose Bool search attribute of
    that name is true.
  - Schedules: a card on the Workflows page and on the Temporal tab of an
    entity (the schedules that start its workflow types) with when they run,
    their next and last runs and whether they are paused; controls on each
    one come from `TemporalScheduleActionBlueprint` (`./alpha`) or the
    `scheduleActions` prop.
  - Query: runs a query on a workflow (`temporal.workflow.query`), offering
    the names the workflow defines, with the description and example from
    `spec.messages`. The buttons that change workflows are in
    `@kwkevinchan/backstage-plugin-temporal-module-control`.
  - Extension points for other plugins and app modules: `temporalApiRef`,
    `useTemporalWorkflow`, `TemporalWorkflowActionBlueprint`,
    `TemporalWorkflowListActionBlueprint` and `TemporalWorkflowSectionBlueprint`
    (`./alpha`), and the `workflowActions`, `workflowListActions` and
    `workflowSections` props for the legacy system.
  - The step graph of the details page can go full screen with its step
    panel (the page goes full screen; Esc leaves). Zooming is with the
    graph's controls: zoom in, zoom out and fit the whole graph.
  - Step boxes are tinted by kind (activity, timer, signal and update, child
    workflow, local activity) and show the status. A step is titled by the
    summary the workflow gave it (Temporal user metadata, e.g. the `summary`
    activity option), with the activity type below it. Workflow lists
    use the column order of the Temporal UI: status, workflow ID, workflow
    type (linked to its entity).
  - Refresh buttons (the workflow page, the workflow lists, the recent runs
    card) send one request per press, however often they are pressed. A
    running workflow's page reloads itself every ten seconds, and pauses
    while its browser tab is in the background.

### Patch Changes

- Updated dependencies [14a8792]
  - @kwkevinchan/backstage-plugin-temporal-common@0.1.0
