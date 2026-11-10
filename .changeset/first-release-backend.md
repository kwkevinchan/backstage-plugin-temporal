---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

First release of the backend plugin. It reads; the operations that change
workflows are in `@kwkevinchan/backstage-plugin-temporal-backend-module-control`.

- Permission-checked routes for the workflows of an entity and of the
  Workflows page: lists, details, the step graph, progress, the event
  history and downloads of large payloads in Temporal External Storage
  (`temporal.externalStorage.s3`: the references of the SDKs' S3 driver,
  read and verified by the backend itself).
- Experimental, off by default (`temporal.experimental.aiWorkflows`), to
  move to a separate package: loops of AI workflows (`GET .../loops`) and
  LLM steps (model and tool calls in the graph and the steps,
  `GET .../llm-calls/:eventId`). When off, graphs and steps carry no loop
  or model call data and those routes answer 404.
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
