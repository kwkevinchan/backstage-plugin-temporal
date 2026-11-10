---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

First release of the backend plugin. It reads; the operations that change
workflows are in `@kwkevinchan/backstage-plugin-temporal-backend-module-control`.

- Permission-checked routes for the workflows of an entity and of the
  Workflows page: lists, details, the step graph, progress, loops, the event
  history and downloads of large payloads in Temporal External Storage
  (`temporal.externalStorage.s3`: the references of the SDKs' S3 driver,
  read and verified by the backend itself).
- LLM steps: model calls (activity ID `llm/...`) and their tool calls
  (`tool/...`) are found without the payload codec; the graph, the steps
  and the loops carry a summary of each call (model, tokens, duration,
  tools, reasoning), and `GET .../llm-calls/:eventId` returns the full
  record (OpenTelemetry GenAI attributes), also from S3, with the history
  permission.
- Queries (`POST .../query`, with `temporal.workflow.query`, recorded with
  the auditor) and `GET .../handlers`, the signals, updates and queries a
  workflow defines, with what its `TemporalWorkflow` entity describes in
  `spec.messages`.
- The `temporal-workflow` permission resource type: `temporal.workflow.list`
  and `temporal.workflow.history.list` are checked with `authorizeConditional`,
  and conditions become a Temporal visibility query for the Workflows page.
  Rules: `HAS_WORKFLOW_TYPE`, `HAS_TASK_QUEUE`, `IN_NAMESPACE` (decided for
  the namespace being listed) and `IS_INITIATOR` (with
  `temporal.searchAttributes.initiator`); `temporalWorkflowConditions` and
  `createTemporalWorkflowConditionalDecision` from `/alpha` for policies.
  Modules can add more rules.
- `GET /schedules` (with `temporal.workflow.list` without conditions) and
  `GET /entities/:kind/:namespace/:name/schedules` (with
  `temporal.workflow.read` on the entity): the Temporal schedules of a
  namespace and those that start an entity's workflow types.
- The default export installs the plugin with the default factory of
  `temporalAccessServiceRef`; a backend can add its own factory instead.
- The workflow lists take a `searchAttribute` filter: only workflows whose
  Bool search attribute of that name is true.
- Graph steps carry the summary of their event (Temporal user metadata).
