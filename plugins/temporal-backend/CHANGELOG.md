# @kwkevinchan/backstage-plugin-temporal-backend

## 0.1.0

### Minor Changes

- First release of the backend plugin.
  `backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))`
  installs the plugin, the default factory of its access service and the
  catalog module with the `TemporalWorkflow` kind; the named exports
  `temporalPlugin` and `catalogModuleTemporalWorkflowKind` (and
  `temporalAccessServiceFactory` in `./alpha`) add them one by one.

  - Routes under `/api/temporal` for the workflows of an entity and of the
    Temporal page: the runs of a workflow ID, the details, event history,
    result, step graph and progress of a run, the Temporal schedules, the
    signals, updates and queries a workflow defines, and the numbers of the
    runs of `TemporalWorkflow` entities (`POST /workflow-types/overview`).
    Every route is checked with the permission framework.
  - The operations that change workflows: start, signal, update, cancel,
    terminate, rerun, custom actions of backend modules, and pause, unpause
    and trigger of schedules, each checked with its permission and recorded
    with the auditor. They are on by default; with
    `temporal.control.enabled: false` their routes do not exist.
    `temporal.control.allowedSignals` and `allowedUpdates` limit the names
    that may be sent. Queries (`temporal.workflow.query`) do not depend on
    `temporal.control.enabled`.
  - The `TemporalWorkflow` kind (`temporal.io/v1alpha1`), validated with its
    schema, with the relations of its owner, system and `spec.dependsOn`. A
    backend without the catalog plugin skips it.
  - The `temporal-workflow` permission resource type: `temporal.workflow.list`
    is checked with `authorizeConditional`, and its conditions become a
    Temporal visibility query. Rules: `HAS_WORKFLOW_TYPE`, `HAS_TASK_QUEUE`,
    `IN_NAMESPACE` and `IS_INITIATOR`.
  - Payloads that workers store with Temporal External Storage are shown by
    their location; the backend never reads the bucket.
  - For backend modules and other backend code: `./node` has
    `temporalServiceRef` (one shared Temporal client, with TLS and bearer token
    authentication) and `TemporalPluginClient`; `./alpha` has
    `temporalAccessServiceRef`, `temporalControlExtensionPoint` (custom
    actions) and the permission conditions; `./common` has the permissions,
    the API types and paths and the annotation constants.
  - The OpenAPI 3.1 spec of the HTTP API, `src/schema/openapi.yaml`,
    published with the package.
  - Experimental, no compatibility promise: the model calls and tool calls of
    the official Temporal AI integrations (Vercel AI SDK and OpenAI Agents
    SDK) and Temporal Event Groups in the step graph.
