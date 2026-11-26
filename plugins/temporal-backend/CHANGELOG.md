# @kwkevinchan/backstage-plugin-temporal-backend

## 0.1.0

### Minor Changes

- e819b25: First release of the backend plugin. One `backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))`
  installs the plugin, the default factory of its access service and the
  catalog module with the `TemporalWorkflow` kind; the named exports
  `temporalPlugin` and `catalogModuleTemporalWorkflowKind` (and
  `temporalAccessServiceFactory` in `./alpha`) add them one by one.

  - Permission-checked routes under `/api/temporal` for the workflows of an
    entity and of the Workflows page: lists, details, the step graph,
    progress, the event history and Temporal schedules. Payloads that workers
    store with Temporal External Storage are shown by their location (the
    references of the SDKs' S3 driver); the backend never reads the bucket.
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
    is checked with `authorizeConditional`,
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
  - An OpenAPI 3.1 spec of the HTTP API, `src/schema/openapi.yaml`, published
    with the package: every route with its parameters, bodies, responses and
    permission, the routes of `temporal.control` and the experimental ones
    marked. The route tests check the requests and responses against it.
  - Experimental, no compatibility promise: model calls of the official
    Temporal AI integrations (`GET .../llm-calls/:eventId`) and Temporal
    Event Groups on the graph. Nothing needs to be turned on.

- b7b17c4: `./common` no longer exports the names of the in-house loop and LLM formats,
  and the `temporal.experimental.aiWorkflows` setting is gone from the config
  schema.

  Removed from `./common` (a generated copy in both packages):

  - constants: `LLM_MARKER_PREFIX`, `LLM_RECORD_KEY`, `LLM_RECORD_VERSION`,
    `LLM_SEMCONV_VERSION`, `LLM_TOOL_RESULT_KEY`, `TOOL_MARKER_PREFIX`,
    `LOOP_MARKER_MEMO_KEY`, `LOOP_STATE_MEMO_KEY`, `LOOP_STATE_QUERY`
  - function: `parseLlmMarker`
  - types: `WorkflowLlmMarker`, `WorkflowLoopGroup`, `WorkflowLoopMarker`,
    `WorkflowLoopRound`, `WorkflowLoopRun`, `WorkflowLoopStatus`,
    `WorkflowLoopStep`, `WorkflowLoopsResponse`

  `./common` now has 110 names, 14 of them `@alpha`.

  A config file that still sets `temporal.experimental.aiWorkflows` keeps
  working: the key is ignored. `backstage-cli config:check` passes with and
  without `--lax`. Only `backstage-cli config:check --strict`, which rejects
  every key that no schema declares, fails on it (`Config must NOT have
additional properties` at `/temporal`). Remove the key from your config.

- b7b17c4: The in-house loop format, the in-house LLM format and the
  `temporal.experimental.aiWorkflows` setting are removed. There is no
  compatibility layer.

  Removed:

  - the private package `@kwkevinchan/temporal-workflow-kit` (`/loop`, `/llm`)
  - reading activity IDs of the form `loop/<name>/<round>/<step>`, the
    `temporal.loops` memo and the `__loop_state` query
  - `GET .../loops` and the graph fields `loop` and `loops`
  - the built-in LLM adapter `temporal-workflow-kit` (activity IDs
    `llm/<call>` and `tool/<call>/<toolCallId>`, result key `temporal.llm`)
  - the config key `temporal.experimental.aiWorkflows`

  Use Temporal Event Groups for loop frames in the graph, and the official
  Temporal AI integration adapters (`vercel-ai-sdk`, `openai-agents`) with
  the LLM panel for model calls. Other frameworks still register through
  `temporalLlmAdapterExtensionPoint` (`TemporalLlmAdapter`).

### Patch Changes

- 769a54e: A workflow whose entity reference search attribute is not an entity reference
  is treated as a workflow without an entity. Opening it without `entityRef`,
  when the list permission does not cover it, answers 403 (as for a workflow
  without the attribute) instead of 400. `POST .../query` no longer answers 400
  for it either: like the operations that change workflows, it needs the
  permission allowed for every entity.
- 769a54e: `./common` no longer exports `isValidControlActionId` and
  `MAX_CONTROL_NAME_LENGTH` (only the backend uses them) and the request types
  `WorkflowTerminateRequest` and `WorkflowRerunRequest`, which no route or
  client used.
- e9441a6: The status of an event group after its run ended is Failed when a step of
  the group failed, even when another step was left open (a timer that had not
  fired), instead of Canceled. A group with a step left open is changed only
  when the run has a known final status; while the status of the run is
  unknown it comes from the steps.
- 82635e4: The graph response (`GET .../graph`) has the Temporal event groups of the
  run (experimental in Temporal; server 1.32 and TypeScript SDK 1.23 or
  later): `eventGroups` lists each group with its key (`label:<id>`,
  `event:<event ID>`, `update:<update ID>`), name, steps, inferred parent and
  child groups, status, times and the tokens of its model calls, and
  `groups` on each step lists the keys of its groups, outer groups first. A
  label is cut like a step summary to its first line; one that a payload
  codec encoded is replaced by the group ID (`labelUnreadable`). A group
  with a step left open when the run ended is Failed (the run failed, timed
  out or was terminated) or Canceled. The groups need the read permission only; runs without groups answer
  as before. The new types `WorkflowEventGroup` and `WorkflowEventGroupKind`
  in `./common` are `@alpha`.

  The built-in LLM adapters' values are no longer copied for every graph;
  values of adapters that modules add still are.

- 2fba3c5: The plugin no longer reads payloads from Temporal External Storage. It shows
  where a stored payload is, from the reference in the history: the location
  (`s3://bucket/key`), the SHA-256 and the size, with copy buttons, for the
  inputs and results of steps, the memo and the record of a model call. The
  History tab and the raw events show the events as JSON, where a stored
  payload appears as `{ encoding, external }`. A model call whose result is stored there shows no model or tokens, and
  a tool step whose arguments are stored there is matched to its model call by
  the tool name alone.

  Removed from the backend: the `temporal.externalStorage.s3` settings
  (`bucket`, `driverName`, `endpoint`, `region`, `forcePathStyle`,
  `credentials`, `accountId`, `defaultCredentials`, `maxInlineBytes`,
  `previewBytes`), the `GET .../payloads/download` routes, and the
  dependencies `@aws-sdk/client-s3`, `@aws-sdk/credential-providers` and
  `@backstage/integration-aws-node`. The backend no longer needs access to the
  bucket. `ExternalPayload` in `./common` only has `store`, `bucket`, `key`,
  `size` and `sha256`.

  Removed from the frontend: `downloadPayload` of `TemporalApi`, and the
  preview, thumbnail and download of stored payloads.

  New, in the frontend: `temporal.externalStorage.objectUrl`, a URL template
  with `{bucket}` and `{key}` (replaced with the URL-encoded values). When it
  is set and starts with `https:`, an Open link goes next to the location.

- 65bbbf4: Model calls and tool calls of the official Temporal AI integrations are
  shown without changing the worker: the Vercel AI SDK integration
  (`@temporalio/vercel-ai-sdk`: `invokeModel`, `invokeModelStreaming`, MCP
  tools) and the OpenAI Agents integration (`@temporalio/openai-agents`:
  `invokeModelActivity`, `invokeModelStreamActivity`). A step is read as a
  model call only when its payloads have the integration's shape; others stay
  plain steps.

  - Model calls need no setting. Whoever has the read permission of a
    workflow sees in the graph what the backend reads from the payloads of
    its model calls:
    the framework, the model, the token counts (also reasoning and cached),
    the finish reason, the names and tool call IDs of the tools asked for,
    and the type of an error. The messages, the thinking and tool
    arguments and results are in the details of the step.
    Payloads in External Storage are not read, so a model call whose result
    is stored there is drawn without its model and tokens.
  - `temporalLlmAdapterExtensionPoint` (`./alpha`) adds LLM adapters for other
    frameworks (`TemporalLlmAdapter`): adapters of modules are asked before
    the built-in ones, a taken ID fails the start, and an adapter that throws
    or returns something of the wrong shape (or not plain JSON, or more than
    100 calls for one step) makes that step a plain step with a warning in
    the log that names the adapter, the event and the error type, not the
    error message.
  - Tool calls are linked to their model call by the tool call ID the step
    records, else by the tool name, arguments and order of the steps; such
    links are marked `inferred` (`WorkflowToolLink`, `WorkflowLlmToolCallRef`),
    and the frontend shows them as **Inferred link**.
  - `WorkflowLlmSummary` and `WorkflowLlmCallResponse` have the `framework`
    that read the call; `call` is optional (the frontend titles a call by its
    summary or model without it). A step can make several model calls
    (`callCount`); `GET .../llm-calls/:eventId?index=` reads one of them.

- 8712f0e: When an entity depends on more than 20 TemporalWorkflow entities, the merged
  execution list includes only the first 20 types (in the order of their entity
  references) and says so, with the total. Open a type in Workflow types to see
  the rest. The list and statistics responses carry `relatedWorkflows` (`total`,
  `queried`).
- 769a54e: One rule decides which schedules belong to an entity, for its schedule list
  and for pausing, unpausing and triggering: the schedule starts a workflow type
  of the entity (or of a related `TemporalWorkflow` entity) and, when that
  entity has a task queue, runs on it. An entity with only a task queue and no
  workflow type has no schedules, so operating on a schedule of its queue is
  refused with 404 like any schedule that is not its own.
- 517df3f: A schedule whose memo or action arguments cannot be decoded (an encoding the
  default data converter does not know, such as encryption, compression or
  `binary/protobuf`) no longer breaks the schedule
  lists, which answered 500 for the whole namespace, nor Pause, Resume and Run
  now on that schedule, which answered 500 with `Unknown encoding`. The
  schedule is listed and operated like any other; the plugin does not show a
  schedule's memo or arguments.
- 22b31ec: A provider-executed tool result on a Vercel AI SDK model call is shown as
  the raw `result` value. An object shaped like `{ type, value }`, and a
  `null`, `0` or empty-string result, stay as they are. A prompt-shaped
  `output` is still unwrapped when `result` is absent.
- 132010c: A provider-executed tool result on a Vercel AI SDK model call is read
  from `result`, and from `output` when `result` is absent, so the Response
  of that part is shown.
