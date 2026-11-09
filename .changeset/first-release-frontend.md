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
- LLM steps of agent workflows: model calls as boxes with the model, tokens,
  duration and tools, their tool calls as smaller boxes next to them, and an
  LLM panel with the input, thinking, output, tool calls (with a link to
  their steps) and usage, copy buttons and the raw record. The Loops tab adds
  up the tokens of each round.
- A `./ui` entry point with the building blocks of the pages (the graph
  canvas and its layout, status helpers, panels, the style class names) for
  companion packages such as `@kwkevinchan/backstage-plugin-temporal-module-zigflow`.
- Workflow lists keep their filters, page and page size in the URL, so the
  browser's back button and the "All workflows" link return to the same
  page. Paging and filtering replace the history entry instead of adding
  one.
- Controls: start, signal, update, query, cancel, terminate and rerun, each
  behind a permission.
- Extension points for other plugins and app modules: `temporalApiRef`,
  `useTemporalWorkflow`, `TemporalWorkflowActionBlueprint` and
  `TemporalWorkflowSectionBlueprint` (`./alpha`), and
  `createTemporalControlActionDef()` for the legacy system.
- The permissions (the same objects as in the backend package), the
  annotation constants and the response types of the backend API.
