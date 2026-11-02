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
  panel for the selected step, and tabs for the steps, loops, a timeline,
  the events and the details. Loops of AI workflows (generate, check,
  revise) show as one box per loop with a control to step through the
  rounds. Large payloads stored in S3 show their size, a preview, a download
  button and a thumbnail of images.
- Controls: start, signal, update, query, cancel, terminate and rerun, each
  behind a permission.
- Extension points for other plugins and app modules: `temporalApiRef`,
  `useTemporalWorkflow`, `TemporalWorkflowActionBlueprint` and
  `TemporalWorkflowSectionBlueprint` (`./alpha`), and
  `createTemporalControlActionDef()` for the legacy system.
- The permissions (the same objects as in the backend package), the
  annotation constants and the response types of the backend API.
