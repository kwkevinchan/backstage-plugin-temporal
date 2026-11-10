---
'@kwkevinchan/backstage-plugin-temporal': minor
---

First release of the frontend plugin, for the legacy and the new frontend
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
- Workflow lists keep their filters, page and page size in the URL, so the
  browser's back button and the "All workflows" link return to the same
  page. Paging and filtering replace the history entry instead of adding
  one.
- `TemporalApi.listEntityWorkflows` and `listWorkflows` take a
  `searchAttribute` option: only workflows whose Bool search attribute of
  that name is true.
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
- Step boxes have a pale background by kind (activity, timer, signal and
  update, child workflow, local activity), mixed from the theme tokens; the
  status keeps the left bar and the border.
- A step titled by the summary the workflow gave it (Temporal user
  metadata, e.g. the `summary` activity option), with the activity type
  below it. Workflow lists in the order of the Temporal UI: status, the
  workflow ID (link), the workflow type (link to its entity).
