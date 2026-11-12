---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

First release of the frontend plugin, for the legacy and the new frontend
system (`./alpha`). It needs the backend plugin
`@kwkevinchan/backstage-plugin-temporal-backend`.

- An entity tab with the workflows of an entity (annotations, the
  `TemporalWorkflow` kind and `spec.dependsOn`), a Workflows page
  (`/temporal`), and cards for `TemporalWorkflow` entities: summary, recent
  run statistics and related workflows.
- Workflow details around a step graph (React Flow with the dagre layout),
  a panel for the selected step, and tabs for the steps, a timeline, the
  events and the details. The graph can go full screen with its step panel.
  Large payloads stored in S3 show their size, a preview, a download button
  and a thumbnail of images.
- The operations that change workflows: Signal, Update, Cancel, Terminate
  and Rerun on the details page, Start workflow above the workflow lists,
  Pause or Resume and Run now on schedules, and buttons for custom backend
  actions (`TemporalControlActionBlueprint` in `./alpha`,
  `createTemporalControlActionDef()` for the legacy system). Signals and
  updates described in `spec.messages` with an `inputSchema` get a form.
  The buttons come with the plugin in both frontend systems and show
  nothing when `temporal.control.enabled` is false. `temporalControlApiRef`
  is the client of those operations.
- Query on every workflow (`temporal.workflow.query`), with the names the
  workflow defines and the description and example from `spec.messages`.
- Schedules: a card on the Workflows page and on the Temporal tab of an
  entity, with when they run, their next and last runs and whether they are
  paused.
- Workflow lists keep their filters, page and page size in the URL. The
  workflow page reloads a running workflow every ten seconds while its
  browser tab is in front, and the Refresh buttons send one request at a
  time.
- Extension points for other plugins and app modules: `temporalApiRef`,
  `useTemporalWorkflow`, `TemporalWorkflowActionBlueprint`,
  `TemporalWorkflowListActionBlueprint`, `TemporalScheduleActionBlueprint`
  and `TemporalWorkflowSectionBlueprint` (`./alpha`), and the
  `workflowActions`, `workflowListActions`, `scheduleActions` and
  `workflowSections` props for the legacy system. `./common` has the
  permissions, the API types and the annotation constants; `./ui` (alpha)
  the building blocks of the pages for companion packages.
- Experimental, off unless the backend sets
  `temporal.experimental.aiWorkflows`: loops of AI workflows (one box per
  loop, the Loops tab) and LLM steps (model and tool calls, the LLM panel).
