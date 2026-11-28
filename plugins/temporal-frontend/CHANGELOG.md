# @kwkevinchan/backstage-plugin-temporal-frontend

## 0.1.0

### Minor Changes

- ab0d8a5: The step graph is laid out with `@dagrejs/dagre` 3. Steps that run in
  parallel can change places within their column: in the graphs drawn from
  left to right, a branch that was drawn above another one can now be drawn
  below it, while every step keeps its column; in the graphs drawn from top
  to bottom (`layoutSteps` with `direction: 'TB'`), parallel branches can
  swap sides. The height of a graph drawn from left to right, and the width
  of one drawn from top to bottom, can change a little. Arrows into the next
  row that turn down less than an arrow lane apart are spread out side by
  side like the ones that turn at the same place, where they all fit and
  none of them then runs on another arrow.
- b799cab: The graph draws the frame of an expanded signal group, or of the group of
  an update that completed, in place of the signal or update that started it:
  the signal or update is no longer a box of its own next to the frame, the
  arrows into it go on to the first steps of the group, and the button in the
  frame's title bar selects it, with the frame shown as selected. A failed,
  rejected or running update keeps its box with its status, and so does the
  start of the run. While the group is collapsed or shown as labels, the
  signal or update is a box of its own as before; so it is when it is a step
  of a group, started more than one group, leads to its group only through
  other steps, or is not in the run. The timeline, the Steps tab and the
  Event Groups tab are unchanged.
- e819b25: First release of the frontend plugin, for the legacy and the new frontend
  system (`./alpha`). It needs the backend plugin
  `@kwkevinchan/backstage-plugin-temporal-backend`; without it the pages say
  that the backend does not serve the Temporal plugin and name that package.

  - An entity tab with the workflows of an entity (annotations, the
    `TemporalWorkflow` kind and `spec.dependsOn`), a Temporal page
    (`/temporal`), and cards for `TemporalWorkflow` entities: summary and
    related workflows. The tab of a `TemporalWorkflow` entity shows the
    recent run statistics.
  - Workflow details around a step graph (React Flow with the dagre layout),
    a panel for the selected step, and tabs for the steps, a timeline, the
    events and the details. The graph can go full screen with its step panel.
    Large payloads stored in S3 show where they are (`s3://bucket/key`, the
    SHA-256 and the size) with copy buttons, and an Open link when
    `temporal.externalStorage.objectUrl` is set.
  - The operations that change workflows: Signal, Update, Cancel, Terminate
    and Rerun on the details page, Start workflow above the workflow lists,
    Pause or Resume and Run now on schedules, and buttons for custom backend
    actions (`TemporalControlActionBlueprint` in `./alpha`,
    `createTemporalControlActionDef()` for the legacy system). Signals and
    updates described in `spec.messages` with an `inputSchema` get a form.
    The buttons come with the plugin in both frontend systems and show
    nothing when `temporal.control.enabled` is false. `TemporalApi`
    (`temporalApiRef`) has these operations besides the reads, with one
    client. An operation that finds no route says that
    `temporal.control.enabled` may be false in the backend, or the backend
    plugin missing.
  - Query on every workflow (`temporal.workflow.query`), with the names the
    workflow defines and the description and example from `spec.messages`.
    A query with an `inputSchema` there gets the same form as a signal or an
    update, any other query a JSON field.
  - Schedules: a card on the Executions tab of the Temporal page and on the Temporal tab of an
    entity, with when they run, their next and last runs and whether they are
    paused.
  - Workflow lists keep their filters, page and page size in the URL. The
    workflow page reloads a running workflow every ten seconds while its
    browser tab is in front, and the Refresh buttons send one request at a
    time.
  - Extension points for other plugins and app modules: `temporalApiRef`,
    `useTemporalWorkflow` (with `TemporalWorkflowProvider` to test a component
    that calls it), `TemporalWorkflowActionBlueprint`,
    `TemporalWorkflowListActionBlueprint`, `TemporalScheduleActionBlueprint`
    and `TemporalWorkflowSectionBlueprint` (`./alpha`, next to the plugin
    as its default export; a section needs a `title` for its tab), and the
    `workflowActions`, `workflowListActions`, `scheduleActions` and
    `workflowSections` props for the legacy system. `./common` has the
    permissions, the API types and the annotation constants; `./ui` (alpha)
    the building blocks of the pages for companion packages.
  - Experimental: model calls and tool calls of the official Temporal AI
    integrations (the LLM panel) and Temporal Event Groups (group frames in
    the graph and the Event Groups tab). Nothing needs to be turned on.

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

- b7b17c4: The in-house loop boxes, the **Loops** tab and
  `temporal.experimental.aiWorkflows` are removed. There is no compatibility
  layer.

  Removed:

  - the Loops tab and `TemporalApi.getWorkflowLoops`
  - graph nodes of `type: 'loop'` (the collapsed/expanded in-house loop box
    and per-round frames)
  - graph fields `loop` and `loops`

  Use Temporal Event Groups for group frames around a loop, and the LLM
  panel with the official Temporal AI integration adapters (`vercel-ai-sdk`,
  `openai-agents`) for model calls.

### Patch Changes

- 769a54e: `./common` no longer exports `isValidControlActionId` and
  `MAX_CONTROL_NAME_LENGTH` (only the backend uses them) and the request types
  `WorkflowTerminateRequest` and `WorkflowRerunRequest`, which no route or
  client used.
- d03e8b6: The step graph draws a small arrowhead at the end of every arrow, in the color
  of the arrow (grey, the color of a running step, or the color of a tool call),
  so the direction of the arrows that turn back to the next row or into a frame
  can be read. An arrow now ends on the border of its box.
- ed6d8ea: The step graph colors each arrow by the kind of the step it leads to, using the same hues as the step boxes, strong enough to read in the light and dark themes. Start, end and wait stay gray. The moving arrow into a running step and the dashed arrow of a tool call keep their own colors.
- 1585ec4: The workflow page draws Temporal event groups: each group is a box around
  its steps in the graph, nested in the box of its parent group and
  collapsible, with its status, duration, tokens and `×N` for the groups
  directly inside. The timeline groups the steps by event group, and an
  **Event Groups** tab lists the groups; pressing one opens it in the graph.
  Runs without event groups are laid out as before. Experimental, like Event
  Groups in Temporal.

  In every run, a model call box without a call name no longer repeats its
  model below the title, and a tool call linked to its model call by name and
  order shows a link icon (with a tooltip) instead of the words "Inferred
  link".

- fdcbd99: In the graph of a run with event groups, arrows into and out of a group's
  box turn outside it, clear of its border, and cross the border straight;
  steps and boxes next to a box are as far from its border as two steps are
  from each other, and arrows that share the gap between two rows run side
  by side. Each group gets a faint color to tell it apart from the groups next
  to it: the outermost groups take four colors in turn and the groups inside
  them have their color; signal and update groups have the color of messages.
  The collapsed boxes, the labels, the timeline and the Event Groups tab show
  the same colors. Runs without event groups are drawn as before.
- f19ec52: In the graph of a run with event groups, the steps of a group that are one
  row line up at their middles, also when a step outside the group (a signal
  received during a round of a loop) is in the column of one of them. A row
  is lined up only when that makes more arrows straight than it bends, and
  moves no step onto an arrow.
  Arrows into the next row that leave or enter groups and turn down at the
  same place, out of different steps or into different steps, turn side by
  side instead of on top of each other, nested so that they do not cross,
  clear of the groups and steps next to them and inside the graph.
  Arrows that share the gap between two rows run 10px apart instead of 6px,
  and the gap between rows with groups is 8px taller for them.
- b799cab: Lining up the rows of event group frames is quicker in graphs with many
  frames to line up, and a row is no longer lined up when that would run an
  arrow along the side of a box.
- 91ba7a2: In the graph of a run with event groups, a group with two or more groups
  directly inside, at least one of them expanded (the rounds of a loop with a
  round open), shows those groups one below the other instead of in one long
  row: each expanded group in a row of its own, with its steps left to right,
  and collapsed groups next to each other in a row, in the order they
  started. An arrow into the next row leaves the right end of a row, runs
  back left in the gap between the rows and enters the next row from the
  left; arrows that run past rows at the sides of the group run side by side
  in lanes, and the gap between two rows is taller when more than three
  arrows run in it. The group of a signal or update received during a round, whose
  arrows lead only from and back into the stacked groups, is drawn in the
  innermost stacked group they lead from and back into (the loop, or the
  round itself when its own groups are stacked), in a row below the row its
  first arrow comes from; the groups of signals received during one row
  share a row, side by side. Groups inside the rows stack in the same way.
  Graphs whose groups are all collapsed, or that hold one group each, are
  laid out as before. `StepLayout` has a new `stackGaps` field with the gaps between
  these rows.
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

- 6e9d8e8: When laying out the step graph throws (a long chain can exhaust the call
  stack in dagre), the graph area shows the error and the rest of the run
  page stays usable. When the call stack ran out, the message says that the
  run has too many steps in a row.
- eb92912: A graph without steps is laid out at a size of zero instead of an infinite
  negative one. Two expanded loops of the same shape, one after the other, keep
  the arrow between the rounds of each loop in the middle of its own gap, instead
  of spreading the two arrows apart as if they shared one gap.
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
- 1cf2e47: The group of a signal or update received during an open round of a loop,
  whose arrows come from that round and lead back into it (or nowhere), now
  goes in the frame of that round instead of a row below it. It runs below
  the steps of the round as a branch in a lane of its own, the groups of a
  round one below the other: the steps of the round stay on their line,
  steps that ran at the same time as a group are in the same column, and the
  steps after it move right when the group needs more room. When the groups
  of a round do not fit in lanes that keep their arrows apart, they stay in
  the row below the round. A frame and a frame inside it no longer
  count as groups side by side, and a box that an arrow only touches by a
  pixel stays where it is.
- 24c643b: In a stacked event-group frame, arrows that leave or enter through a gap
  between rows take a lane in that gap, and an arrow whose way down beside
  its target or its source is blocked, or that would run across a row of
  groups side by side, turns down the side of the frame on the next free
  lane instead of running through the rows. The side widens for arrows past
  three, and the lanes there go around an arrow that runs on past the frame.
  An arrow inside a row no longer runs through a taller box next to it: that
  box moves just enough to clear the line. Graphs without stacked frames are
  unchanged.
