---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

First release of the backend plugin. One `backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))`
installs the plugin, the default factory of its access service and the
catalog module with the `TemporalWorkflow` kind; the named exports
`temporalPlugin` and `catalogModuleTemporalWorkflowKind` (and
`temporalAccessServiceFactory` in `./alpha`) add them one by one.

- Permission-checked routes under `/api/temporal` for the workflows of an
  entity and of the Workflows page: lists, details, the step graph,
  progress, the event history, Temporal schedules and downloads of large
  payloads in Temporal External Storage (`temporal.externalStorage.s3`: the
  references of the SDKs' S3 driver, read and verified by the backend
  itself).
- The operations that change workflows: start, signal, update, cancel,
  terminate, rerun, custom actions, and pause, unpause and trigger of
  schedules, each checked with its permission and recorded with the
  auditor. `temporal.control.allowedSignals` and `allowedUpdates` limit the
  names that may be sent. They are on by default; with
  `temporal.control.enabled: false` their routes do not exist (404) and the
  custom actions added by modules are ignored with a warning. Without a
  permission policy every signed-in user may use them.
- Queries (`POST .../query`, with `temporal.workflow.query`, recorded with
  the auditor) and `GET .../handlers`, the signals, updates and queries a
  workflow defines, with what its `TemporalWorkflow` entity describes in
  `spec.messages`. Neither depends on `temporal.control.enabled`.
- The `TemporalWorkflow` kind (`temporal.io/v1alpha1`), validated with its
  schema, with the relations of its owner, system and `spec.dependsOn`. A
  backend without the catalog plugin skips it.
- The `temporal-workflow` permission resource type: `temporal.workflow.list`
  and `temporal.workflow.history.list` are checked with `authorizeConditional`,
  and conditions become a Temporal visibility query for the Workflows page.
  Rules: `HAS_WORKFLOW_TYPE`, `HAS_TASK_QUEUE`, `IN_NAMESPACE` and
  `IS_INITIATOR` (with `temporal.searchAttributes.initiator`);
  `temporalWorkflowConditions` and `createTemporalWorkflowConditionalDecision`
  in `./alpha` for policies.
- For backend modules and other backend code: `./node` has
  `temporalServiceRef` (one shared Temporal client, with TLS and bearer token
  authentication); `./alpha` has `temporalAccessServiceRef`,
  `temporalControlExtensionPoint` (custom actions),
  `temporalWorkflowEnricherExtensionPoint` (workflow enrichers, add only) and
  `temporalWorkflowPermissionResourceRef`; `./common` has the permissions, the API types and paths,
  the annotation constants and the `TemporalWorkflow` schema. These entry
  points do not load the plugin itself. A new major of `@temporalio/client`
  is a new major of this package.
- A child workflow opens on the page of the entity of its parent (up to
  three levels). The workflow lists take a `searchAttribute` filter (a Bool
  search attribute that is true). Graph steps carry the summary of their
  event (Temporal user metadata).
- Experimental, off by default (`temporal.experimental.aiWorkflows`), no
  compatibility promise: loops of AI workflows (`GET .../loops`) and LLM
  steps (`GET .../llm-calls/:eventId`). When off, graphs and steps carry no
  loop or model call data and those routes answer 404.
