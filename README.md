# Backstage plugin for Temporal

> **Unofficial.** This project is a community plugin. It is not affiliated with,
> endorsed by, or supported by Temporal Technologies, Inc. or the Backstage
> project. "Temporal" is used only to describe what the plugin connects to.

**Status: pre-release.** The first release will be `0.1.0`. Until `1.0.0`,
minor versions may change the API.

The plugin shows [Temporal](https://temporal.io) workflows next to the catalog
entities that own them in [Backstage](https://backstage.io), and lets people
operate them from there, with every operation checked by the Backstage
permission framework and recorded with the auditor.

## Documentation

This README is the reference. The guides in [`docs/`](docs/README.md) explain how
the plugin works and why: a Temporal primer, how a request travels from the
browser to Temporal, the architecture, a comparison with the Temporal Web UI,
a walkthrough with the example worker, and the
[public interfaces](docs/public-interfaces.md) for integrators: every entry
point, extension point, route, permission and setting other code can rely on.
They are also available in Traditional Chinese
([繁體中文](docs/zh-TW/README.md)).

## Terms

The plugin uses the Temporal terms:

| Term                     | Meaning                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Workflow Type            | The name of a workflow, for example `orderWorkflow`. It stands for one Workflow Definition (the workflow code). |
| Workflow Execution       | One execution of a workflow type: one row of a workflow list.                                                   |
| Workflow Run             | One part of a workflow execution that continues as new. Each run has its own Run ID.                            |
| Workflow Execution Chain | The runs of a workflow that continued as new, oldest first. They share the Workflow ID.                         |

A `TemporalWorkflow` catalog entity stands for one workflow type and its
workflow definition.

## Features

- **Workflow executions of an entity.** A **Temporal** tab on catalog
  entities lists their workflow executions with workflow type, status, times
  and the progress of each one (steps done, the current step or the
  failure).
- **Step graph.** The details page of a run is built around a graph of its
  steps: activities with their attempts, timers, signals, updates, child
  workflows and the wait the run is in. Selecting a step opens a panel with
  its input, output, error, attempts and events.
- **Timeline.** The same steps on a time axis: how long each step waited for
  a worker and how long it ran, retries, timers and waits, signals and
  updates. Bars of a running workflow grow until now; the chart zooms.
- **Workflow definitions (separate packages).** For workflows written in
  YAML (CNCF Serverless Workflow DSL 1.0, as
  [Zigflow](https://github.com/zigflow/zigflow) runs it),
  `@kwkevinchan/backstage-plugin-temporal-module-zigflow` adds a **Definition** tab
  to `TemporalWorkflow` entities: the YAML next to its graph, with a run laid
  over it (see [Workflow definitions](#workflow-definitions)).
- **Large payloads in External Storage.** Payloads that workers store in
  S3 with Temporal External Storage (the `ExternalStorage` of the Temporal
  SDKs and its S3 driver) are shown as JSON, as a preview or as an image,
  and can be downloaded through the backend (see
  [Large payloads](#large-payloads-external-storage)).
- **Workflow controls.** Start, signal, update, query, cancel, terminate and
  rerun workflows, and add your own actions.
- **Workflow types in the catalog.** A `TemporalWorkflow` catalog kind for
  one workflow type and its definition, and a **Workflows** page with every
  workflow execution of a namespace.
- **Templates.** Scaffolder actions to start a workflow, wait for it and
  send it a signal or an update, and a form field to pick a workflow (see
  [Templates](#templates-scaffolder)).
- **Permissions.** Every read and every operation goes through the
  Backstage permission framework and is recorded with the auditor (see
  [Permissions](#permissions)).
- **Model calls and tool calls** (experimental shape). Workflows that use
  the official Temporal AI integrations (Vercel AI SDK, OpenAI Agents SDK)
  show each model call as a box with the model, tokens, duration and number
  of tools; the tool calls it asked for hang off it. Its panel shows the
  input, the thinking, the output, the tool calls and the usage. Nothing to
  turn on and nothing to change in the worker; other frameworks can be
  added with a backend module (see
  [Model calls and tool calls](#model-calls-and-tool-calls)).

**Experimental, off by default.** The loop views are not part of the first
release and will move to a separate package. Turn them on with
`temporal.experimental.aiWorkflows: true` (no compatibility promise):

- **Loops of AI workflows.** Rounds of generate, check and revise loops are
  grouped into one box in the graph (expanded: one frame per round), one
  group per round in the timeline,
  and one row per round in the **Loops** tab, across continue-as-new runs
  (with `@kwkevinchan/temporal-workflow-kit/loop`, see
  [the workflow kit](plugins/temporal-workflow-kit)).

| Workflows of an entity                                           | Step graph and step panel                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| ![Workflow list of an entity](docs/images/entity-tab.png)        | ![Step graph with the step panel](docs/images/details-graph.png) |
| **Timeline**                                                     | **Loop rounds** (experimental)                                   |
| ![Timeline of a loop workflow](docs/images/timeline.png)         | ![A loop expanded, one frame per round](docs/images/loop.png)    |
| **Large payload in S3**                                          | **Workflow controls**                                            |
| ![An image stored in S3](docs/images/s3-payload.png)             | ![Terminate dialog](docs/images/controls.png)                    |
| **A model call and its tool calls**                              | **LLM panel**                                                    |
| ![A model call with three tool calls](docs/images/llm-graph.png) | ![LLM panel of a model call](docs/images/llm-panel.png)          |

## Packages

| Package                                                                                                          | Role                   | Install in        | Purpose                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kwkevinchan/backstage-plugin-temporal-backend`](plugins/temporal-backend)                                     | backend-plugin         | Backstage backend | The core. REST API under `/api/temporal` that reads and operates workflows, the permission checks, the `TemporalWorkflow` catalog kind, and for backend code: the shared Temporal client (`./node`), the extension points (`./alpha`) and the permissions and types (`./common`).                                                                               |
| [`@kwkevinchan/backstage-plugin-temporal-frontend`](plugins/temporal-frontend)                                   | frontend-plugin        | Backstage app     | Entity tab, workflow details, Workflows page and the buttons of the operations. Legacy entry point; `./alpha` for the new frontend system with the blueprints for workflow actions, list actions, schedule actions, sections and buttons of custom backend actions; `./common` for the permissions and types; `./ui` for companion packages. Needs the backend. |
| [`@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`](plugins/temporal-backend-module-zigflow)       | backend-plugin-module  | Backstage backend | Reads the definition files for the Definition tab (optional, with the module below). Needs the backend plugin.                                                                                                                                                                                                                                                  |
| [`@kwkevinchan/backstage-plugin-temporal-module-zigflow`](plugins/temporal-module-zigflow)                       | frontend-plugin-module | Backstage app     | Definition tab for workflows written in YAML and run by Zigflow (optional). Needs the frontend plugin and the backend module above.                                                                                                                                                                                                                             |
| [`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal`](plugins/scaffolder-backend-module-temporal) | backend-plugin-module  | Backstage backend | Scaffolder actions: start a workflow, wait for it, send a signal or an update (optional). Calls a reachable Temporal backend plugin.                                                                                                                                                                                                                            |
| [`@kwkevinchan/backstage-plugin-scaffolder-module-temporal`](plugins/scaffolder-module-temporal)                 | frontend-plugin-module | Backstage app     | Scaffolder form field `TemporalWorkflowPicker` (optional). Needs the frontend plugin.                                                                                                                                                                                                                                                                           |
| [`@kwkevinchan/temporal-workflow-kit`](plugins/temporal-workflow-kit)                                            | node-library           | Your workers      | Experimental, not published yet (with the AI views). Not a Backstage package. `/loop`: loop markers, a loop state query and continue-as-new helpers. `/llm`: records of model calls (OpenTelemetry GenAI).                                                                                                                                                      |

Which ones to install:

- **Everyone:** the backend plugin in the backend and the frontend plugin in
  the app. One `backend.add()` brings the read routes, the operations that
  change workflows (on by default, see
  [Workflow controls](#workflow-controls)) and the `TemporalWorkflow` kind.
  The frontend shows the buttons of the operations unless
  `temporal.control.enabled` is false.
- **Backend only:** the backend plugin works without the frontend: other
  backend plugins and modules call Temporal through its shared client
  (`temporalServiceRef`), and the API serves any client that has Backstage
  credentials. The frontend plugin does not work without the backend plugin:
  its pages show an error that says the backend does not serve the Temporal
  plugin and names `@kwkevinchan/backstage-plugin-temporal-backend` (when
  the backend cannot be reached at all, the error of the request).
- **With workflows written in YAML for Zigflow:** the two Zigflow modules
  (frontend and backend) for the Definition tab. Without the backend module
  the tab says that it is missing.
- **With templates:** the Scaffolder modules. The backend module may run in
  another backend than the Temporal plugin; it calls the plugin over HTTP.
- **With loops of AI workflows (experimental):** the workflow kit in your
  Temporal workers (not in Backstage; not published yet). Model calls of the
  official Temporal AI integrations need nothing more.
- **With large payloads in External Storage:** nothing more; the backend
  reads the references itself and only needs `temporal.externalStorage.s3`.

The catalog module of the backend package is skipped when the backend has no
catalog plugin; a split deployment adds `catalogModuleTemporalWorkflowKind` to
the backend that runs the catalog.

Plugins and app modules that add buttons or tabs to the workflow page use the
frontend plugin (`./alpha` for the blueprints); backend modules use
`./node` and `./alpha` of the backend plugin, and permission policies its
permissions in `./common`.

Development-only packages (never published): `packages/app` (legacy frontend
system), `packages/app-next` (new frontend system), `packages/backend` and
`packages/example-worker`.

## Compatibility

| Component       | Supported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backstage       | **1.56.x** only (see `backstage.json`). Both frontend systems: legacy (`EntityPage.tsx`) and new (`./alpha`).                                                                                                                                                                                                                                                                                                                                                                                        |
| Temporal server | Tested with **1.32** (self-hosted, and the development server of the Temporal CLI 1.9).                                                                                                                                                                                                                                                                                                                                                                                                              |
| Temporal SDK    | The backend uses `@temporalio/client` **1.24**; a new major of it is a new major of the plugin packages. `@kwkevinchan/temporal-workflow-kit/loop` (experimental, not published yet) needs `@temporalio/workflow` 1.12 or later (tested with 1.24); Large payloads: Temporal External Storage with the S3 driver (TypeScript SDK 1.21 or later, tested with 1.24; public preview). Event groups: server 1.32 and TypeScript SDK 1.23 or later (tested with 1.24 and 1.25; experimental in Temporal). |
| Node.js         | 22 or 24.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The screens use the Backstage design system `@backstage/ui`; the app must
load its styles (`import '@backstage/ui/css/styles.css'`, as apps created for
1.56 do). Light and dark themes follow the app theme. The step graph uses
[React Flow](https://reactflow.dev) (`@xyflow/react`) with the
[dagre](https://github.com/dagrejs/dagre) layout, both MIT licensed; the
timeline is drawn with plain HTML and CSS.
The backend parses YAML with [`yaml`](https://eemeli.org/yaml/) (ISC).

## Installation

> **Security.** The operations that change workflows are on by default.
> Without a permission policy (the allow-all policy), every signed-in user
> may start, cancel and terminate workflows. `temporal.control.allowedSignals`
> and `allowedUpdates` only limit the names of signals and updates; they do
> not stop cancel or terminate. Restrict the operations with a permission
> policy (see [Permissions](#permissions)) or turn them off with
> `temporal.control.enabled: false` (see
> [Workflow controls](#workflow-controls)).

### Backend

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend
```

`packages/backend/src/index.ts`:

```ts
// The plugin, the operations that change workflows and the TemporalWorkflow
// kind of the catalog.
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
```

The backend plugin needs the catalog and the permission framework. It only
uses `@temporalio/client` (no worker code runs inside Backstage). Add at
least `temporal.connection` to your app config (see
[Configuration](#configuration)), and allow the kind in the catalog rules if
you use `TemporalWorkflow` entities (see
[Workflow entities](#workflow-entities)).

The default export is a feature loader. To leave a part out, add the
features one by one instead:

```ts
import {
  catalogModuleTemporalWorkflowKind,
  temporalPlugin,
} from '@kwkevinchan/backstage-plugin-temporal-backend';
import { temporalAccessServiceFactory } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';

backend.add(temporalPlugin);
// Needed with temporalPlugin: the default access checks. A backend with its
// own factory for temporalAccessServiceRef adds that one instead.
backend.add(temporalAccessServiceFactory);
// The TemporalWorkflow kind, in the backend that runs the catalog.
backend.add(catalogModuleTemporalWorkflowKind);
```

**Content security policy.** With large payloads in External Storage, the step panel shows
stored images as thumbnails from `blob:` URLs. The backend's default content
security policy does not allow them, so in production (where the backend
serves the app) add `blob:` to `img-src`, or the thumbnails stay empty:

```yaml
backend:
  csp:
    img-src: ["'self'", 'data:', 'blob:']
```

`backend.csp` replaces the default list of a directive, so keep `'self'` and
`data:`. The development server of the frontend (`yarn start`) does not send
this header, so the problem only shows in a production build.

### Frontend, new frontend system

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-frontend
```

Add the plugin to your app features, or let feature discovery find it:

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';

export default createApp({ features: [temporalPlugin /* ... */] });
```

This adds a **Temporal** tab to entities of any kind that have Temporal
annotations, to `TemporalWorkflow` entities and to entities that depend on
them; a summary card on the overview of `TemporalWorkflow` entities; a card
with the workflow entities on the overview of entities that depend on them;
and the **Workflows** page on `/temporal`. The page has a title and an icon,
so the app lists it in the sidebar with the nav items it discovers from pages
(`navItems` of `NavContentBlueprint`).

The buttons of the operations (Signal, Update, Cancel, Terminate, Rerun,
Start workflow, and Pause, Resume and Run now on schedules) are extensions
of the plugin; they show nothing when `temporal.control.enabled` is false.

### Frontend, legacy frontend system

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-frontend
```

`EntityPage.tsx`:

```tsx
import {
  EntityTemporalContent,
  isTemporalAvailable,
} from '@kwkevinchan/backstage-plugin-temporal-frontend';

<EntityLayout.Route path="/temporal" title="Temporal" if={isTemporalAvailable}>
  <EntityTemporalContent />
</EntityLayout.Route>;
```

Add the route to the entity page of every kind that can carry the
annotations; the plugin does not depend on the entity kind.

For `TemporalWorkflow` entities, add a page to the `EntitySwitch`:

```tsx
import {
  EntityTemporalRelatedWorkflowsCard,
  EntityTemporalWorkflowSummaryCard,
  getDependsOnTemporalWorkflowRefs,
  isTemporalWorkflowEntity,
} from '@kwkevinchan/backstage-plugin-temporal-frontend';

const temporalWorkflowPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      <Grid container spacing={3}>
        <Grid item md={6} xs={12}>
          <EntityAboutCard />
        </Grid>
        <Grid item md={6} xs={12}>
          <EntityTemporalWorkflowSummaryCard />
        </Grid>
      </Grid>
    </EntityLayout.Route>
    <EntityLayout.Route path="/temporal" title="Temporal">
      <EntityTemporalContent />
    </EntityLayout.Route>
  </EntityLayout>
);

<EntitySwitch>
  <EntitySwitch.Case
    if={isTemporalWorkflowEntity}
    children={temporalWorkflowPage}
  />
  {/* ... */}
</EntitySwitch>;
```

`EntityTemporalRelatedWorkflowsCard` lists the workflow entities of a
component (use it with
`if={e => getDependsOnTemporalWorkflowRefs(e).length > 0}`).

The Workflows page (`App.tsx` and the sidebar in `Root.tsx`):

```tsx
import { TemporalPage } from '@kwkevinchan/backstage-plugin-temporal-frontend';
import AccountTreeIcon from '@material-ui/icons/AccountTree';

<Route path="/temporal" element={<TemporalPage />} />;

<SidebarItem icon={AccountTreeIcon} to="temporal" text="Workflows" />;
```

`EntityTemporalContent` and `TemporalPage` show the buttons of the
operations by themselves, first in the action bar and above the lists; the
`workflowActions`, `workflowListActions` and `scheduleActions` props add
yours after them.

## Workflow details

The details page of a run shows, from top to bottom:

- a header: the workflow ID and the run ID, with the actions on the right
  (controls, your own actions, the link to the Temporal UI, a refresh
  button and, for running workflows, **Auto refresh**). Below a line, the
  fields in a grid: status, where the run is now (what it waits for, or the
  step it failed at), the run of the execution chain (`Run 2 of 3`, with
  links to the run before and after and an explanation of continue-as-new),
  workflow type, duration and start time. Running workflows reload every
  ten seconds while the tab is in front. The step graph is fetched when the
  run changed (new events, another status or run, or a change in its pending
  activities; a heartbeat alone does not count) and at least once a minute.
  The **Auto refresh** switch turns this off. The **Raw** events are the
  exception: they are loaded when opened and again when you press **Refresh**
  or finish an action (or the page moves to another run), not by the
  automatic reload.
- the step graph: one box per step and arrows between them. Colors follow
  the status, running steps pulse, waiting steps are dashed, retried
  activities show their attempt (`×3`), and a child workflow links to its own
  details. The graph can be zoomed, panned and fitted to the view. Selecting
  a step opens a panel with its input, output, error, attempts and events.
- tabs: **Steps** (a table of the steps), **Timeline** (see below),
  **Events** (grouped by step, or the raw history), **Details** (the summary table, failure, pending activities,
  search attributes and memo), and one tab per workflow section.

### Timeline

The **Timeline** tab draws the steps of the run on a time axis, one row per
step, oldest first, with offsets from the start of the run (`+1m 30s`):

- activities and child workflows: a light bar for the time the step waited
  for a worker (scheduled to started; for a retried activity this includes
  the earlier attempts and the retry backoff) and a solid bar for the time it
  ran (started to closed). The label counts retries (`2 retries`).
- colors follow the status like the graph: failed and timed-out steps are
  red. Timers and waits are dashed; signals, updates and the end of the run
  are points.
- the first row is the whole run. For a running workflow, open steps reach
  to now (a vertical line) and grow while the page refreshes.
- steps of a loop are grouped by round; the latest round of each loop is
  open and the others can be expanded (one at a time, or all at once). A
  run that continued as new shows its own rounds only.
- drag across the chart to zoom in to that range; Ctrl (or ⌘) + scroll
  zooms around the pointer, Shift + scroll pans, and **Whole run** zooms
  out. Hovering a bar shows its times, durations and attempts; pressing it
  opens the same step panel as the graph.

The backend builds the steps from the history (`GET .../graph`):

| Step           | Events                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------- |
| Activity       | `ActivityTask*` by scheduled event ID, with the current attempt of pending activities         |
| Timer          | `TimerStarted`, `TimerFired`, `TimerCanceled`                                                 |
| Signal         | `WorkflowExecutionSignaled`; signals sent by the workflow: `SignalExternalWorkflowExecution*` |
| Update         | `WorkflowExecutionUpdate*` by update ID (admitted, accepted, completed, rejected)             |
| Child workflow | `StartChildWorkflowExecution*` and `ChildWorkflowExecution*` by initiated event ID            |
| Marker         | `MarkerRecorded` (for example local activities)                                               |
| Start and end  | `WorkflowExecutionStarted` and the closing event, including continue-as-new                   |

Workflow task events are internal steps, hidden unless a workflow task
failed (the grouped event view can show them). A step B follows a step A when
B started after A ended (by event ID); steps whose time ranges overlap, like
activities scheduled together, become parallel branches. A running workflow
with nothing open gets a **Waiting** step. Its text comes from a search
attribute whose name ends with `Pending` and whose value is true, for example
`ApprovalPending` gives "Waiting for approval"; without one it says "Waiting
for an external event (signal or update)", since the history does not tell
which signal or update handler the workflow waits for.

Limits: Temporal records only the last attempt of an activity and the
failure of the attempt before it, so earlier attempts are not listed.
Updates rejected by a validator are not written to the history. The backend
reads at most 5000 events per run; the graph of a longer history shows its
start and says so.

Workflow lists keep their filters, page and page size in the URL
(`?status=Running&page=2&pageSize=50`), so the browser's back button and the
**← Workflow executions** link of the details page return to the same page, at the
same scroll position. Temporal's page tokens are kept in the browser's
session storage; when they are gone (another tab), the list opens on the
first page and says so.

Workflow lists start with the workflow type, then the workflow ID, status
and progress. **Show all runs** also lists the earlier runs of workflows that
continued as new; without it each execution chain shows its latest run.
A page size from the URL that is not one of the offered sizes
(`?pageSize=5`) is added to the **Per page** choices.

Workflow lists show a progress column (done steps and the current step or
failure). It is loaded for the rows on screen only, with at most four
requests at a time; the backend reads at most 1000 events per run for it and
keeps the progress of closed runs in memory.

## Loops

> **Experimental, off by default.** Set `temporal.experimental.aiWorkflows: true`. This view will move to a separate package; there is no compatibility promise.

AI workflows often loop: generate, check, and revise when the check fails,
for dozens of rounds and across continue-as-new runs. Drawn step by step,
such a graph becomes unreadable. When the activities and child workflows of
each round carry a loop marker (`loop/<loop>/<round>/<step>` in the activity
ID; see [`@kwkevinchan/temporal-workflow-kit`](plugins/temporal-workflow-kit)
for the format and a TypeScript helper, `/loop`):

- the graph shows each loop as one box, `draft-review · Round 4 of 5 · Done`,
  with the steps before it and after it. Pressing the box, or **Expand**
  above the graph, shows every round of the run, one frame per round from
  top to bottom: its title has the round, decision and score
  (`Round 3 · revise · score 0.81`), a running round pulses and a failed one
  is red. The steps of a round go left to right inside its frame and wrap
  inside it when it is wider than the graph. Arrows lead from the step
  before the loop to the first round, from round to round, and from the last
  round to the step after it. Expanding brings the running round, else the
  last failed one, else the last one into view; a round pressed in the
  **Loops** tab is brought into view instead. Timers and signals that start
  during a round belong to it.
- a run that continued as new shows its own rounds only, with a note above
  the first frame (the rounds of the earlier runs) and below the last one
  (`The loop continues in run 3`). Its loop state is `continued`, shown as
  **Continues in next run**.
- the **Loops** tab has one table per loop: each round with its steps,
  status, duration, decision and score, newest first. Pressing a round shows
  it in the graph. Rounds of a workflow that continued as new are counted
  across its runs (`GET .../loops` reads up to 20 runs); a round of another
  run links to that run, opened at the round.
- the limit, the state (`running`, `done`, `exhausted`, `failed`, and
  `continued` for a run that continued as new while the loop ran) and the
  decisions and scores come from the `temporal.loops` memo the helper
  upserts after each round, and for a running workflow from its
  `__loop_state` query when a worker answers within three seconds.

Workflows without markers look as before. The loop data needs the read
permission, like the graph; inputs and results are not part of it.

<a id="llm-steps"></a>

## Model calls and tool calls

> **Experimental.** The shape of the data changes before the first stable release. Nothing needs to be turned on.

LLM agents call a model, run the tools it asks for, and call it again. The
backend recognizes these steps in the history with LLM adapters: a step an
adapter recognizes is shown as a model call (messages, tool calls, tokens),
any other step as a plain step. The worker does not change for the plugin.

Built-in adapters:

| Adapter (`framework`) | Integration                                                        | Model calls                                                   | Tool calls                                                                                        |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `vercel-ai-sdk`       | `@temporalio/vercel-ai-sdk` 1.0 (with `ai` 7)                      | Activities `invokeModel`, `invokeModelStreaming`              | MCP tools (`<server>-callTool`) by their tool call ID; tools defined in the workflow by inference |
| `openai-agents`       | `@temporalio/openai-agents` 1.24 (with `@openai/agents-core` 0.14) | Activities `invokeModelActivity`, `invokeModelStreamActivity` | `activityAsTool` tools by inference                                                               |

Embedding calls (`invokeEmbeddingModel`) have no messages and stay plain
steps. A step is taken for a model call only when its input and result have
the shape of the integration, since anyone can give an activity these names.

What the plugin shows:

- the graph draws a model call as a larger box with the model, the input and
  output tokens, the duration and the number of tools. Its title is the call
  name when the step records one, else the step's summary (the `summary`
  option of the integrations, for example `languageModel.summary` or
  `modelParams.summary`), else the model. The tool calls it asked for are
  smaller boxes with the tool name, joined to it by dashed arrows, so an
  agent loop reads as model call, tools, model call. Retries of a tool show
  on its box.
- selecting a model call opens the LLM panel: **Input** (system
  instructions and messages as a chat, long texts collapsed), **Thinking**
  (collapsed), **Output**, **Tool calls** (name, arguments, response,
  status, and a button to the step of the tool) and **Usage** (input,
  output, reasoning and cached tokens, duration). Every section has a copy
  button; **Raw JSON** shows the input and result the record was read from.
  A tool step links back to its model call.
- the **Timeline** marks model and tool calls.

Tool calls are linked to the model call that asked for them in two ways. A
step that records the tool call ID (MCP tools of the Vercel AI SDK) is
linked to the model call whose output has that ID. Other steps are matched
by inference: a step scheduled after the model call ended and before the
next model call of the agent (the one whose input answers the tool call),
with the tool's name (ignoring case and separators, so `search_docs` runs
as `searchDocs`), preferring the one with the same arguments. Inferred links
are marked **Inferred link**. Two calls of one tool with the same arguments
in parallel cannot be told apart; they are paired in the order the steps
were scheduled.

The graph and the timeline need the read permission only, and show names
and numbers the backend reads from the payloads of a model call: the
framework, the model, the token counts (input, output, reasoning, cached),
the finish reason, the names and tool call IDs of the tools it asked for,
and the type or message of an error. No setting turns this on: whoever may
read a workflow sees it wherever the history has model calls. The
messages, the thinking and tool arguments and results need
`temporal.workflow.history.read`, like inputs and results
(`GET .../llm-calls/:eventId`; `?index=` picks a later call of a step that
made several).

Known limits:

- a payload codec (for example encryption) encodes the inputs and results:
  the backend cannot read them, and the model calls are plain steps.
- tool links of tools that record no tool call ID are inferred (above).
- without `temporal.workflow.history.read`, the graph does not download the
  input of a model call from External Storage (it is the whole
  conversation; with the permission the graph reads every payload). When
  the input is stored there,
  the graph lacks what only the input has: the model of an OpenAI Agents
  call, and the end of the inference window, which then is the next model
  call. The panel reads the full record, input included.
- only the TypeScript integrations were checked against recorded histories.
  The streamed calls show their result; the stream itself
  (`__temporal_workflow_stream_publish` signals) stays a list of signals.
- the provider is not in the history of either integration, so it is not
  shown.

Other frameworks are added with a backend module and
`temporalLlmAdapterExtensionPoint` (see
[Extending](#extending) and the
[public interfaces](docs/public-interfaces.md#llm-adapters)). The
unreleased `@kwkevinchan/temporal-workflow-kit` has its own format
(activity IDs `llm/<call>`, `tool/<call>/<tool call ID>` and a
`temporal.llm` record with the
[OpenTelemetry GenAI](https://github.com/open-telemetry/semantic-conventions-genai)
attributes); the backend still reads it with an internal adapter
(`temporal-workflow-kit`), which will be removed together with the kit.

## Event groups

> **Experimental.** Event Groups are an experimental feature of Temporal
> and may change; so may the data below. Nothing needs to be turned on.

A workflow can put the commands it sends (activities, timers, child
workflows, local activities) into
[event groups](https://github.com/temporalio/sdk-typescript/blob/main/packages/workflow/src/event-groups.ts),
for example one group for a loop and one for each of its rounds. Temporal
records the groups of each command on its event (`eventGroupMarkers`), and
the Temporal Web UI filters the history by them. The backend reads them
into the graph (`GET .../graph`); the worker does not change for the
plugin.

This needs Temporal server 1.32 or later and an SDK that writes Event
Groups (TypeScript SDK 1.23 or later). With older versions the plugin works
as before, without groups.

What the graph response has:

- `eventGroups`: each group of the run, in the order it started, with its
  key (`label:<id>`, `event:<event ID>` for the commands of a signal
  handler, `update:<update ID>` for those of an update handler; the same
  keys as the `groups` parameter of the Temporal UI), its name, its steps
  (`nodeIds`), its parent and child groups, its status, its start and
  end, and the tokens of the model calls in it.
- `groups` on each step: the keys of its groups, outer groups first.

The steps of a group can include internal steps (for example a memo
upsert or a cancel request to another workflow); the frontend decides
which to show. A group is Running while a step of it is open, Failed when
a step failed, Canceled when a step was canceled, else Completed. Once the
run has ended, a group with a step left open (an activity abandoned by a
timeout or a termination, a timer that had not fired) is Failed when the
run failed, timed out or was terminated, else Canceled, and it ends when
the run ended.

The name is the label of the group, cut like the summary of a step to its
first line, trimmed; else its ID; a signal handler's group
is `<signal name> (<event ID>)`, an update handler's
`<update name> (<update ID>)`, as in the Temporal UI. A payload codec
encodes the label (not the ID): the backend cannot read it, so the group is
named by its ID and marked `labelUnreadable`.

Temporal records no parent of a group: the events list the groups of a
step as one flat list, outer groups first. The backend infers the nesting.
A group is inside another when every step of it is also in the other one
and the other one comes first in the groups of each of these steps; of
several such groups, the innermost one. So:

- two groups whose steps overlap without one containing the other (for
  example two tags on some of the same steps) have no parent;
- two groups on the same steps nest in the order of the list;
- a group that a workflow puts on a single step inside another group reads
  as nested in it, since the history looks the same.

Commands of a signal or update handler carry only the handler's group, not
the group the workflow was in at that time. A child workflow's step has
the groups of the parent's event; the child's own history has only its own
groups. Groups do not continue across continue-as-new: each run has its
own, and the continued-as-new event counts in the group it was called in.
The graph needs the read permission only, like the summaries of the steps:
the groups, their names and their tokens are shown to anyone who may read
the workflow. A run has at most 1000 groups and a step 32; more are left
out (`eventGroupsTruncated`).

## Workflow definitions

Workflows written in YAML (CNCF Serverless Workflow DSL 1.0, as
[Zigflow](https://github.com/zigflow/zigflow) runs it on Temporal) can show
their definition on a **Definition** tab of their `TemporalWorkflow` entity:
the YAML next to its graph, with a run laid over it. The tab is not part of
this plugin; it comes in two separate packages, so apps without Zigflow do
not carry it:

| Package                                                         | Adds                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@kwkevinchan/backstage-plugin-temporal-module-zigflow`         | The Definition tab (frontend, both frontend systems)               |
| `@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow` | The route that reads the definition files (module of this backend) |

Setup, the `spec.definition` field of the entity and the configuration
(`temporal.definitions`) are in the
[Zigflow package README](plugins/temporal-module-zigflow/README.md).

| Definition tab: YAML and graph                        | A run on top of the graph                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| ![YAML next to its graph](docs/images/definition.png) | ![A run laid over the definition](docs/images/definition-run.png) |

## Configuration

The complete set of keys; only `temporal.connection.address` is required.
The `definitions` keys belong to the optional Zigflow backend module and are
described in the README of the Zigflow frontend module
([`plugins/temporal-module-zigflow`](plugins/temporal-module-zigflow/README.md)).

```yaml
temporal:
  connection:
    # Temporal frontend service, host:port.
    address: temporal-frontend.temporal.svc:7233
    # Namespaces the plugin may read; requests for others are rejected.
    # Default: only defaultNamespace, which is always included.
    namespaces: [default, orders]
    # Namespace of entities without temporal.io/namespace. Default: default.
    defaultNamespace: default
    # Connect with TLS (server certificate checked with the system's CAs),
    # for example to Temporal Cloud. Default: false. No client certificates.
    tls: true
    auth:
      # none (default) or bearer, see Authentication below.
      type: bearer
      token: ${TEMPORAL_TOKEN}
  # Optional: adds "Open in Temporal UI" links.
  webUi:
    baseUrl: https://temporal-ui.example.com
  # Optional: names of custom search attributes registered in Temporal.
  searchAttributes:
    # Keyword attribute with the entity reference, e.g. component:default/orders.
    entityRef: BackstageEntityRef
    # Keyword attribute set to the user who started a workflow from Backstage.
    initiator: BackstageInitiator
  # Optional: the operations that change workflows (on by default), and the
  # signals and updates that may be sent.
  control:
    enabled: true
    allowedSignals: [addNote, close]
    allowedUpdates: [setPriority]
  # Optional: large payloads in Temporal External Storage, see Large payloads.
  externalStorage:
    s3:
      bucket: temporal-payloads
      endpoint: http://rustfs.storage.svc:9000
      region: us-east-1
      forcePathStyle: true
      credentials:
        accessKeyId: ${PAYLOAD_S3_ACCESS_KEY}
        secretAccessKey: ${PAYLOAD_S3_SECRET_KEY}
      maxInlineBytes: 262144
      previewBytes: 2048
  # Optional (Zigflow backend module): limits of the Definition tab.
  definitions:
    maxBytes: 1048576
    readFileLocations: false
  # Optional: views that are not part of the first release, see Loops.
  experimental:
    aiWorkflows: false
```

| Key                                     | Default              | Meaning                                                                                                                                                                                               |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection.address`                    | (required)           | Temporal frontend service, `host:port`.                                                                                                                                                               |
| `connection.namespaces`                 | `[defaultNamespace]` | Namespaces the plugin may read; `connection.defaultNamespace` is always added to the list. The UI uses one namespace per entity; the API takes it as a parameter.                                     |
| `connection.defaultNamespace`           | `default`            | Namespace of entities without `temporal.io/namespace` or `spec.namespace`.                                                                                                                            |
| `connection.tls`                        | `false`              | Connect with TLS, the server certificate checked with the system's CAs (for example Temporal Cloud). Client certificates (mTLS) are not supported; see [Authentication](#authentication).             |
| `connection.auth.type`                  | `none`               | `none`, or `bearer` to send `Authorization: Bearer <token>`.                                                                                                                                          |
| `connection.auth.token`                 |                      | Token for `bearer`. A secret: read it from an environment variable.                                                                                                                                   |
| `webUi.baseUrl`                         |                      | Temporal Web UI; adds "Open in Temporal UI" links.                                                                                                                                                    |
| `searchAttributes.entityRef`            |                      | Keyword search attribute with the entity reference of a workflow.                                                                                                                                     |
| `searchAttributes.initiator`            |                      | Keyword search attribute set to the user who started or reran a workflow from Backstage.                                                                                                              |
| `control.enabled`                       | `true`               | Serve the routes that change workflows and show their buttons. When false, those routes do not exist (404) and custom actions are ignored; see [Workflow controls](#workflow-controls).               |
| `control.allowedSignals`                | (all)                | Signal names that may be sent.                                                                                                                                                                        |
| `control.allowedUpdates`                | (all)                | Update names that may be sent.                                                                                                                                                                        |
| `externalStorage.s3.bucket`             | (required)           | Bucket the workers store payloads in.                                                                                                                                                                 |
| `externalStorage.s3.driverName`         | `aws.s3driver`       | Driver name the workers' S3 driver writes (`driverName` of `S3StorageDriver`).                                                                                                                        |
| `externalStorage.s3.endpoint`           | AWS S3               | Endpoint of an S3-compatible service.                                                                                                                                                                 |
| `externalStorage.s3.region`             | `us-east-1`          | Region of the bucket.                                                                                                                                                                                 |
| `externalStorage.s3.forcePathStyle`     | `false`              | Bucket in the path instead of the host name (most self-hosted services).                                                                                                                              |
| `externalStorage.s3.credentials`        |                      | An access key of the plugin: `accessKeyId`, `secretAccessKey` and optional `sessionToken`, with read access (`s3:GetObject`). One of `credentials`, `accountId` and `defaultCredentials` is required. |
| `externalStorage.s3.accountId`          |                      | An AWS account of Backstage's `aws.accounts` (as a string), whose own access key, profile or role the plugin reads with.                                                                              |
| `externalStorage.s3.defaultCredentials` | `false`              | `true`: read with the AWS SDK's default credential chain (environment, profile, instance or pod role); see the warning below.                                                                         |
| `externalStorage.s3.maxInlineBytes`     | `262144`             | JSON payloads up to this size are shown like payloads in the history.                                                                                                                                 |
| `externalStorage.s3.previewBytes`       | `2048`               | Bytes of text shown as the preview of a larger payload.                                                                                                                                               |
| `definitions.maxBytes`                  | `1048576`            | Zigflow module: largest definition file read, in bytes (at most 8 MiB).                                                                                                                               |
| `definitions.readFileLocations`         | `false`              | Zigflow module: read definitions next to entities from `file:` locations (development catalogs).                                                                                                      |
| `experimental.aiWorkflows`              | `false`              | Show the loops (experimental, no compatibility promise). Model calls are shown without it.                                                                                                            |

All keys are under `temporal`. `maxInlineBytes` and `previewBytes` must be
non-negative integers. The frontend reads `connection.defaultNamespace`,
`webUi` and `control`; the token and the S3 credentials stay in the backend.

### Authentication

With `auth.type: bearer`, every call to Temporal carries
`Authorization: Bearer <token>`:

```yaml
temporal:
  connection:
    address: temporal-frontend.temporal.svc:7233
    auth:
      type: bearer
      token: ${TEMPORAL_TOKEN}
```

The token is a secret (it is never sent to the browser); read it from an
environment variable or a mounted secret. The plugin passes the token as the
`apiKey` connection option of `@temporalio/client`. The connection uses TLS
only with `tls: true` (server certificate checked with the system's CAs),
for example for an API key of Temporal Cloud; without it, the token is sent
in clear text, for a Temporal server inside a private network. Client
certificates (mTLS) are not supported yet.

A self-hosted Temporal server checks such tokens when its `global.authorization`
config sets `jwtKeyProvider.keySourceURIs` (the public keys of the token
issuer, as JWKS), `authorizer: default` and `claimMapper: default`. The
default claim mapper reads the permissions claim (`permissionsClaimName`,
by default `permissions`) with values like `default:read`, meaning the read
role on the `default` namespace. To show workflows, a token with the read
role on the namespaces in `connection.namespaces` is enough; the workflow
controls (start, signal, update, cancel, terminate, rerun) need the write
role.
See the Temporal documentation on server security for the details. The token
is read at startup; restart the backend after it is replaced.

## Large payloads (External Storage)

Workers can keep large payloads out of the workflow history with
[Temporal External Storage](https://docs.temporal.io/external-storage)
(public preview in the Temporal SDKs, TypeScript SDK 1.21 or later): the
SDK stores payloads above a threshold (default 256 KiB) in S3 with the S3
driver, and the history keeps a reference with the bucket, key and SHA-256
of the stored object. The workers set it up; this plugin only reads.

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { ExternalStorage } from '@temporalio/common';
import { S3StorageDriver } from '@temporalio/external-storage-s3';
import { AwsSdkS3StorageDriverClient } from '@temporalio/external-storage-s3-aws-sdk';

const driver = new S3StorageDriver({
  client: new AwsSdkS3StorageDriverClient(
    new S3Client({ region: 'us-east-1' }),
  ),
  bucket: 'temporal-payloads',
});
const dataConverter = {
  externalStorage: new ExternalStorage({ drivers: [driver] }),
};
// The same data converter for Worker.create() and new Client().
```

For an S3-compatible service (RustFS, MinIO), give the `S3Client` an
`endpoint` and `forcePathStyle: true`. Temporal does not delete stored
objects: give the bucket a lifecycle rule that keeps objects longer than the
longest workflow run plus the namespace retention period. In a monorepo,
`@temporalio/common` and `@temporalio/proto` must share one copy of
`protobufjs`; with two copies (another dependency wants protobufjs 7) the SDK
fails with "type must be a Type", and a `protobufjs@^8` dependency in the
root package fixes the layout.

To show the stored data in Backstage, give the backend read access to the
same bucket (and allow `blob:` images, see [Installation](#backend)). An
S3-compatible service (RustFS, MinIO), with an access key of the plugin:

```yaml
temporal:
  externalStorage:
    s3:
      bucket: temporal-payloads
      # Leave out for AWS S3.
      endpoint: http://rustfs.storage.svc:9000
      region: us-east-1
      forcePathStyle: true
      credentials:
        accessKeyId: ${PAYLOAD_S3_ACCESS_KEY}
        secretAccessKey: ${PAYLOAD_S3_SECRET_KEY}
      # JSON payloads up to this size are shown like any other payload.
      maxInlineBytes: 262144
      # Bytes of text shown as the preview of a larger payload.
      previewBytes: 2048
```

The credentials come from exactly one of three sources; the backend does
not start with none or with two:

- `credentials`: an access key of the plugin, as above.
- `accountId`: an AWS account that Backstage's `aws` config manages
  (`@backstage/integration-aws-node`), with its access key, profile or role
  (`roleName`, `externalId`, `webIdentityTokenFile`). The entry needs its
  own role or access key (or profile): an entry without them would read
  with the identity of the machine, and the backend does not start.
  Use an account entry of its own, as the TechDocs publisher does with
  `techdocs.publisher.awsS3.accountId`:

  ```yaml
  aws:
    accounts:
      - accountId: '123456789012'
        roleName: temporal-payload-reader
  temporal:
    externalStorage:
      s3:
        bucket: temporal-payloads
        region: eu-central-1
        # A string: unquoted, YAML reads it as a number.
        accountId: '123456789012'
  ```

- `defaultCredentials: true`: the AWS SDK's default credential chain, for
  example the role of the instance or pod. The plugin never falls back to
  it on its own, so that a configuration with a missing key does not read
  with the identity of the machine. Without `aws.mainAccount` (with an
  access key or profile), Backstage's URL reader also uses this identity,
  so use it only when the identity of the machine should let Backstage
  read this bucket; the backend logs a warning.

At startup the backend logs one line with the bucket, the host of the
endpoint, the region and which source it reads with (never a secret). It does not start
when the `accountId` entry of `aws.accounts` has no role, access key or
profile. It warns when the `accountId` is not in `aws.accounts` (so it can
only be the main account) or is the account of a `roleArn` in
`integrations.awsS3`, and when `defaultCredentials: true` is set without an
`aws.mainAccount` of its own: Backstage's URL reader reads with those (see
[Security](#security)). Temporary
credentials (a role) are renewed before they expire.

When S3 cannot be read (a missing object, refused credentials), the step
panel and the download say "Could not read the stored payload from S3";
the error of S3 is in the backend log, with the key of the object.

**Why not `integrations.awsS3`.** Backstage's URL reader reads every host
of `integrations.awsS3` with the credentials of that entry, and the AWS
entry (`amazonaws.com`) with the main AWS account when it has none. The
catalog (locations), the Scaffolder (templates that fetch a URL) and the
Definition tab of the Zigflow module read URLs that users give. With the
same credentials, anyone who can have Backstage read a URL could read the
stored payloads without `temporal.workflow.history.read`. There is also
only one AWS entry in Backstage, so a role on it would change the
credentials of every S3 read. The plugin's credentials are therefore its
own.

**Why the plugin reads the objects itself.** Backstage's URL reader
downloads a whole object into memory before it returns, and cannot stop at
a size. The objects are written by the workers, at sizes Backstage does not
control, so the backend asks S3 for no more than 50 MiB (an HTTP `Range`)
and stops when the object is larger.

The step panel then shows, for the input and output of each step:

- JSON up to `maxInlineBytes` (default 256 KiB): the value, as for payloads
  in the history, with a note that it is stored in S3 and a download button;
- larger payloads: an icon, the size, the media type and the first
  `previewBytes` of text, and a download button; images (PNG, JPEG, GIF,
  WebP up to 8 MiB) as a thumbnail. The SDK does not record a media type,
  so the backend takes it from the encoding and, for binary data, from the
  first bytes;
- without `temporal.externalStorage.s3`: "Stored in External Storage (S3 is
  not configured in Backstage)" with the bucket, key and SHA-256, and no
  error;
- a payload in another bucket, written by another driver, larger than
  50 MiB (by its reference or by the S3 object itself: the backend asks
  for no more than that), missing, or not matching its SHA-256: the error.

The backend reads the stored payload itself (the S3 object is a Temporal
`Payload` message). Payloads that the workers' codec encrypted before they
were stored stay undecodable, like encrypted payloads in the history.

Downloads go through the backend,
`GET /api/temporal/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/payloads/download?key=<key>`,
with the same checks as the history (`temporal.workflow.history.read`, or
the list permissions without `entityRef`). The key must belong to a
reference in the history of that run, and the reference must name the
configured bucket and driver, so a caller cannot read other objects. The
backend downloads the object, checks its SHA-256 and decodes it before it
sends the data. The S3 credentials stay in the backend: the plugin does not
use presigned URLs, because a presigned URL works for anyone who has it
until it expires, outside of the Backstage permission checks. The cost is
that downloads pass through the backend (up to 50 MiB, the limit of the S3
driver).

The backend keeps up to 32 MiB of downloaded objects in memory, by SHA-256,
so reloading a page does not download the same data again.

## Workflow entities

The backend plugin adds the `TemporalWorkflow` kind to the catalog (its
catalog module, `catalogModuleTemporalWorkflowKind`). One entity stands for
one Temporal Workflow Type and its Workflow Definition (the workflow code);
the entity page shows it as **Workflow type**. Its workflow executions are
listed on its Temporal tab.

```yaml
apiVersion: temporal.io/v1alpha1
kind: TemporalWorkflow
metadata:
  name: order-workflow
  description: Reserves stock and confirms an order.
spec:
  owner: group:default/orders-team # required
  workflowType: orderWorkflow # required
  taskQueue: orders
  namespace: default # optional, defaults to connection.defaultNamespace
  system: shop
  lifecycle: production
  dependsOn: [resource:default/orders-db]
```

| Field       | Relations                    |
| ----------- | ---------------------------- |
| `owner`     | `ownedBy` / `ownerOf`        |
| `system`    | `partOf` / `hasPart`         |
| `dependsOn` | `dependsOn` / `dependencyOf` |

`spec.definition` (`format`, `target`) points to the file of the workflow
for its **Definition** tab: a YAML workflow (`serverless-workflow`), drawn as
a graph, or the source code (`source`), with the workflow's function marked;
see [Workflow definitions](#workflow-definitions).

The workflow executions of the entity are those with that workflow type (and task
queue, when set), or with the entity reference
(`temporalworkflow:default/order-workflow`) in the `searchAttributes.entityRef`
attribute. `workflowType`, `taskQueue` and `namespace` follow the same rules
as the annotations. Allow the kind in `catalog.rules`.

A component (or any entity) that uses a workflow lists it in the standard
`spec.dependsOn`:

```yaml
kind: Component
spec:
  dependsOn:
    - temporalworkflow:default/order-workflow
```

The catalog adds `dependsOn` / `dependencyOf`. The component's Temporal tab
then lists the workflow types it depends on (**Workflow types**), and its
workflow executions are its own (from the annotations, if any) together with
those of each workflow type entity; executions of a workflow type entity
link to it. Workflow entities in another Temporal
namespace than the component's, or that the user may not read
(`temporal.workflow.read`), are left out. `dependsOn` is used rather than a
new relation type because it means what the link means ("needs this to
work"), the catalog graph and the about card already show it, and it needs
no processor for other kinds.

## Annotations

| Annotation                  | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `temporal.io/namespace`     | Temporal namespace; defaults to `defaultNamespace`. |
| `temporal.io/task-queue`    | Task queue of the entity's workflows.               |
| `temporal.io/workflow-type` | Workflow types, separated by commas.                |

```yaml
metadata:
  annotations:
    temporal.io/namespace: default
    temporal.io/task-queue: orders
    temporal.io/workflow-type: orderWorkflow,paymentWorkflow
```

These annotation keys are chosen by this unofficial plugin; they are not
defined by Temporal.

An entity's workflows are the executions that match the task queue **and** one
of the workflow types (each is optional), **or** carry the entity reference in
the `searchAttributes.entityRef` attribute, when that is configured. Annotation
values may only contain letters, digits and `. _ - : /`; other values are
rejected so they cannot change the visibility query.

## Permissions

| Permission                       | Resource type       | Used for                                                                                                      |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `temporal.workflow.read`         | `catalog-entity`    | Workflow list, details, step graph (with step summaries and event group labels), progress, Zigflow definition |
| `temporal.workflow.history.read` | `catalog-entity`    | Event history, inputs and results                                                                             |
| `temporal.workflow.list`         | `temporal-workflow` | Workflows page and its schedules; details and step graph without an entity                                    |
| `temporal.workflow.history.list` | `temporal-workflow` | Event history, inputs and results without an entity                                                           |
| `temporal.workflow.query`        | `catalog-entity`    | Run a query chosen by the user (the Query dialog)                                                             |
| `temporal.workflow.start`        | `catalog-entity`    | Start a workflow of the entity or from the Workflows page; pause, resume and run its schedules                |
| `temporal.workflow.signal`       | `catalog-entity`    | Send a signal                                                                                                 |
| `temporal.workflow.update`       | `catalog-entity`    | Send an update (also used by the example custom action)                                                       |
| `temporal.workflow.cancel`       | `catalog-entity`    | Ask a running workflow to cancel                                                                              |
| `temporal.workflow.terminate`    | `catalog-entity`    | Terminate a running workflow, with a reason                                                                   |
| `temporal.workflow.rerun`        | `catalog-entity`    | Start a run again with the same input                                                                         |

The plugin registers the permissions and checks them on every request. The
entity permissions use the entity as the resource. `temporal.workflow.list`
allows the Workflows page, which lists the workflows of the allowed
namespaces, and opening the details and the step graph of any of them
without an entity. Their event history, inputs and results also need
`temporal.workflow.history.list`. Both are resource permissions on the
`temporal-workflow` resource type (a workflow): a policy can allow them,
deny them, or return a conditional decision with these rules (see
[Workflow conditions](#workflow-conditions)). An unconditional
ALLOW lets a user read every workflow. When a
request names an entity (`entityRef`), the entity permissions are checked as
before. Without the history permission the step graph is still shown, without
inputs and results. Access is open by default: with the permission
framework disabled, or with the allow-all policy (as in the development
backend), every signed-in user can read every entity's workflows. To restrict
it, handle these permissions in your Backstage permission policy. Both are
resource permissions on the catalog entity, so a policy can reuse catalog
rules. For example, to give access to the owners of the entity:

```ts
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import { isResourcePermission } from '@backstage/plugin-permission-common';

if (
  request.permission.name.startsWith('temporal.') &&
  isResourcePermission(request.permission, 'catalog-entity')
) {
  return createCatalogConditionalDecision(
    request.permission,
    catalogConditions.isEntityOwner({
      claims: user?.info.ownershipEntityRefs ?? [],
    }),
  );
}
```

The permission backend sends this conditional decision to the catalog to
resolve; this is covered by an integration test in the backend plugin.

### Workflow conditions

The backend plugin registers these rules for the `temporal-workflow`
resource type, used by `temporal.workflow.list` and
`temporal.workflow.history.list`:

| Rule                | Params          | Allows the workflows                                                  |
| ------------------- | --------------- | --------------------------------------------------------------------- |
| `HAS_WORKFLOW_TYPE` | `workflowTypes` | of one of these workflow types                                        |
| `HAS_TASK_QUEUE`    | `taskQueues`    | on one of these task queues                                           |
| `IN_NAMESPACE`      | `namespaces`    | of one of these Temporal namespaces                                   |
| `IS_INITIATOR`      | `claims`        | started by one of these users (`temporal.searchAttributes.initiator`) |

For the Workflows page, the conditions become a Temporal visibility query
that is added to the list query (`allOf` with AND, `anyOf` with OR).
`IN_NAMESPACE` is decided for the namespace being listed, because a
visibility query cannot filter on the namespace; a list whose conditions
match no workflow of the namespace is refused (403). `not` is only accepted
around `IN_NAMESPACE`. `IS_INITIATOR` allows nothing when the initiator
search attribute is not configured. A workflow opened without an entity is
checked against the same rules.

For example, to let users see the workflows they started in the `default`
namespace:

```ts
import {
  createTemporalWorkflowConditionalDecision,
  temporalWorkflowConditions,
} from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';
import { isResourcePermission } from '@backstage/plugin-permission-common';

if (isResourcePermission(request.permission, 'temporal-workflow')) {
  return createTemporalWorkflowConditionalDecision(request.permission, {
    allOf: [
      temporalWorkflowConditions.inNamespace({ namespaces: ['default'] }),
      temporalWorkflowConditions.isInitiator({
        claims: user?.info.ownershipEntityRefs ?? [],
      }),
    ],
  });
}
```

A backend module can add more rules with
`coreServices.permissionsRegistry.addPermissionRules` and
`temporalWorkflowPermissionResourceRef` from
`@kwkevinchan/backstage-plugin-temporal-backend/alpha`. A rule's `toQuery`
returns a visibility query (the part after `WHERE`).

## Workflow controls

> **Security.** The operations are on by default. Without a permission
> policy (the allow-all policy), every signed-in user may start, cancel and
> terminate workflows. `allowedSignals` and `allowedUpdates` only limit the
> names of signals and updates; they do not stop cancel or terminate.
> Restrict the operations with a policy (below) or turn them off.

The operations that change workflows (start, signal, update, cancel,
terminate, rerun, custom actions, and pause, resume and run now on
schedules) come with the two core packages: the routes with the backend
plugin, the buttons with the frontend plugin. Turn them all off with one
key, read by both:

```yaml
temporal:
  control:
    enabled: false
```

The backend then serves none of those routes (they answer 404 without a body), ignores the
custom actions that modules add (with a warning in the log; the modules
still start), and the pages show no buttons for them. Reading, Query and the
Definition tab are not affected. The Scaffolder steps `temporal:workflow:start`
and `temporal:workflow:signal` fail with a message that names the key;
`temporal:workflow:wait` keeps working. Query needs `temporal.workflow.query`
and is never turned off by this key.

The details page has an action bar with the operations that fit the run:

- running: **Signal…**, **Update…**, **Cancel** and **Terminate**;
- closed: **Rerun**;
- always: **Query…** (also when `temporal.control.enabled` is false).

Cancel and Terminate ask for confirmation; Terminate needs a reason, which is
kept in the history. Rerun starts a new workflow with the input, workflow
type, task queue, memo, timeouts, retry policy and search attributes of the
run's start event, under a new workflow ID, and opens it. The Signal, Update
and Query dialogs offer the names the workflow defines (read with the
`__temporal_workflow_metadata` query of the Temporal SDKs; any name can be
typed; the backend lists them at `GET .../handlers`), take the arguments as
JSON and show the result or the error, for example the message of an update
validator.

A `TemporalWorkflow` entity can describe the signals, updates and queries of
its workflow in `spec.messages`. The dialogs then show the description,
fill the arguments with the example and, for a signal, update or query with
an `inputSchema` (JSON Schema of its one argument), show a form instead of
the JSON field (with `@rjsf/core`, as in the Scaffolder). `userField` names a
property of the argument that is filled with the signed-in user's entity
reference and cannot be changed in the form; the workflow should still check
it, since a request can be sent without the form. Handlers the entity
describes are listed even when no worker answers the metadata query.

```yaml
spec:
  workflowType: releaseWorkflow
  messages:
    updates:
      - name: approve
        description: Approve or reject the release
        inputSchema:
          type: object
          required: [approved]
          properties:
            approved: { type: boolean, title: Approve }
            comment: { type: string, title: Comment }
            by: { type: string, title: Approver }
        example: { approved: true }
        userField: by
    queries:
      - name: approvalState
        description: Phase, pending approvals and the decision
```

The backend reads the entity of the run (the entity the page is shown for,
one it depends on, or the one that matches the workflow type and task queue)
with the caller's permissions; an entity the caller cannot read describes
nothing.

**Start workflow** is on the Temporal tab of `TemporalWorkflow` entities and
on the Workflows page. For an entity, the workflow type and task queue come
from its spec, and the input is filled with `spec.exampleInput` (an array of
arguments, or one value):

```yaml
spec:
  workflowType: ticketWorkflow
  taskQueue: support
  exampleInput:
    title: Printer is out of paper
```

The backend only starts the entity's own workflow types on its task queue,
and sets the `searchAttributes.entityRef` and `searchAttributes.initiator`
attributes (when configured) to the entity and the user. From the Workflows
page, the workflow type and task queue are typed in. Leave the workflow ID
empty to have one made from the workflow type.

Every operation is checked with the permission framework, and a button the
user may not use is disabled with the reason as tooltip. **By default every
operation is allowed**: with the allow-all policy (or the permission framework
off), every signed-in user can use them. The permissions are resource
permissions on the workflow's entity: the entity the page is shown for, else
the entity in the `searchAttributes.entityRef` attribute. A workflow without
an entity (opened from the Workflows page) is only controlled when the policy
allows the permission without conditions. Starting from the Workflows page
also needs `temporal.workflow.list`. The operations on one workflow, and
queries, first load it with the read checks: `temporal.workflow.read` on the
entity (with `entityRef`; the workflow must belong to it, 404 otherwise), or
`temporal.workflow.list` for a workflow it covers when no `entityRef` is
given, else `temporal.workflow.read` on the entity of the search attribute.
A user with `temporal.workflow.signal` but without read access gets 403.
Queries only read the workflow; they need `temporal.workflow.query` besides
the read permission. Denied requests answer 403. Signal, update, cancel and
terminate answer 409 when the workflow is not running, start and rerun when
the workflow ID is taken, and the schedule operations when Temporal refuses
the operation in the state of the schedule. Each operation is recorded
with the auditor service (`workflow-start`, `workflow-signal`,
`workflow-update`, `workflow-query`, `workflow-cancel`, `workflow-terminate`,
`workflow-rerun`, `workflow-action`), with the user, the workflow and the
operation. The Temporal history shows the user as the identity
(`backstage:user:default/jane`).

```yaml
temporal:
  control:
    # Empty or absent allows every name.
    allowedSignals: [addNote, close]
    allowedUpdates: [setPriority]
```

A policy that lets only the owners of an entity terminate or cancel its
workflows, and everyone start, signal and update them:

```ts
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import { isPermission } from '@backstage/plugin-permission-common';
import {
  temporalWorkflowCancelPermission,
  temporalWorkflowTerminatePermission,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';

if (
  isPermission(request.permission, temporalWorkflowTerminatePermission) ||
  isPermission(request.permission, temporalWorkflowCancelPermission)
) {
  return createCatalogConditionalDecision(
    request.permission,
    catalogConditions.isEntityOwner({
      claims: user?.info.ownershipEntityRefs ?? [],
    }),
  );
}
```

To turn an operation off for everyone, return `{ result: AuthorizeResult.DENY }` for
its permission.

Inputs and results (of the workflow and of each activity) are decoded like
the default data converter does and shown as JSON. Payloads that cannot be
decoded (binary, or encrypted by a codec) are shown with their encoding and
size only. Inputs and results are part of the history and need
`temporal.workflow.history.read`.

## Schedules

Temporal schedules start workflows on a calendar or an interval. The
Workflows page lists the schedules of the default namespace, and the
Temporal tab of an entity lists those that start its workflow types (on its
task queue, when it has one). Each one shows when it
runs (`every 1h`, `02:00 on MONDAY-FRIDAY`, with its time zone), whether it
is paused and why, its next run and a link to the workflow of its last run.

Unless `temporal.control.enabled` is false, each schedule has **Pause** or **Resume** and
**Run now**. They need `temporal.workflow.start`, since a schedule starts
workflows: on the entity whose workflow types it starts, or without
conditions on the Workflows page. Each one is recorded with the auditor
(`schedule-pause`, `schedule-unpause`, `schedule-trigger`). Creating and
changing schedules is left to code or the Temporal UI.

The Workflows page lists schedules for users that may list every workflow
(`temporal.workflow.list` without conditions); an entity's list needs
`temporal.workflow.read` on the entity. At most the first 500 schedules of a
namespace are read. A schedule whose memo or arguments cannot be decoded
(an encoding the default converter does not know, such as encryption or
compression by a codec) is listed and operated like any other.

## Templates (Scaffolder)

Software templates can start workflows, wait for them and send them signals
or updates with the actions of
[`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal`](plugins/scaffolder-backend-module-temporal),
and let the user pick a workflow with the `TemporalWorkflowPicker` field of
[`@kwkevinchan/backstage-plugin-scaffolder-module-temporal`](plugins/scaffolder-module-temporal).
The actions run as the user who runs the template, through the plugin's own
routes, so the same permissions and audit records apply. Other plugins can
do the same from the frontend with `temporalApiRef`.

## Extending

New frontend system, with the blueprints of
`@kwkevinchan/backstage-plugin-temporal-frontend/alpha`:

```ts
TemporalWorkflowActionBlueprint.make({
  name: 'approve',
  params: {
    loader: () => import('./ApproveButton').then(m => m.ApproveButton),
    filter: workflow => workflow.status === 'Running',
  },
});
```

`TemporalWorkflowSectionBlueprint` adds a tab in the same way, and
`TemporalWorkflowListActionBlueprint` a control above the workflow lists
(its `filter` gets the entity, absent on the Workflows page). They attach to
the shared mount point `api:temporal/workflow-extensions`, so they show on
the pages of the entity tab and of the Workflows page. In the legacy system, pass
`workflowActions`, `workflowSections`, `workflowListActions` and
`scheduleActions` to `EntityTemporalContent` and to `TemporalPage`. Components get the workflow as props or through
`useTemporalWorkflow()`. To test a component that
calls the hook, wrap it in `TemporalWorkflowProvider`.

To change one of the plugin's own extensions, such as the Workflows page,
take it from the plugin with `getExtension()` and install the plugin with
`withOverrides()`. The plugin does not export its extensions by name; the IDs
are `page:temporal`, `entity-content:temporal`,
`entity-card:temporal/workflow-summary`,
`entity-card:temporal/related-workflows`, `api:temporal`,
`temporal-workflow-action:temporal/controls`,
`temporal-workflow-list-action:temporal/start` and
`temporal-schedule-action:temporal/controls`.

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';

export default createApp({
  features: [
    temporalPlugin.withOverrides({
      extensions: [
        temporalPlugin
          .getExtension('page:temporal')
          .override({ params: { path: '/pipelines', title: 'Pipelines' } }),
      ],
    }),
  ],
});
```

`api:temporal` takes its parameters as a callback, so give it your own
implementation of `TemporalApi` like this (a plain object, as for the page,
makes the app fail at startup):

```ts
temporalPlugin.getExtension('api:temporal').override({
  params: defineParams =>
    defineParams({
      api: temporalApiRef,
      deps: {},
      factory: () => myClient,
    }),
});
```

To remove an extension, disable it in `app.extensions`. The shared mount
point `api:temporal/workflow-extensions` is internal: it can be disabled, but
its API is not exported, so it cannot be replaced with your own
implementation.

Backend modules that serve their own routes under `/api/temporal` use the
plugin's access checks through `temporalAccessServiceRef`
(`@kwkevinchan/backstage-plugin-temporal-backend/alpha`). To decide access in
another way, add your own factory for that ref to the backend; the default
factory that the backend package brings is then skipped.

Backend modules can add data to workflow summaries with
`temporalWorkflowEnricherExtensionPoint.addWorkflowEnricher()`, and custom
workflow actions with `temporalControlExtensionPoint.addControlAction()`,
both from `@kwkevinchan/backstage-plugin-temporal-backend/alpha`. The
enricher extension point only adds enrichers; it cannot add actions. Actions
are ignored, with a warning, when `temporal.control.enabled` is false. An action is served as
`POST .../actions/:actionId`; the backend reads the workflow, checks the
action's permission on its entity, runs the optional `filter`, records the
call with the auditor and passes a Temporal client to `handle`. The client
reaches every workflow of the namespace, with the backend's credentials,
while the permission was only checked for the workflow of the request: an
action that signals, starts or changes other workflows must check the
permissions for those itself, with `temporalAccessServiceRef` from
`@kwkevinchan/backstage-plugin-temporal-backend/alpha`: `loadWorkflow()` reads
the other workflow and its entity, then `authorizeOn()` checks the
permission on that entity.

```ts
temporal.addControlAction({
  id: 'escalate',
  permission: temporalWorkflowUpdatePermission,
  filter: workflow => workflow.status === 'Running',
  async handle(ref, body, { client }) {
    const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
    return handle.executeUpdate('setPriority', { args: ['high'] });
  },
});
```

The frontend plugin shows it as a button that runs the action and shows the
result. New frontend system, with the blueprint of
`@kwkevinchan/backstage-plugin-temporal-frontend/alpha`:

```ts
TemporalControlActionBlueprint.make({
  name: 'escalate',
  params: {
    actionId: 'escalate',
    label: 'Escalate',
    confirm: 'Raise the priority to high?',
    // Optional: disables the button without the permission.
    permission: temporalWorkflowUpdatePermission,
    filter: workflow => workflow.status === 'Running',
  },
});
```

Legacy system: add
`createTemporalControlActionDef({ actionId: 'escalate', label: 'Escalate' })`
of `@kwkevinchan/backstage-plugin-temporal-frontend` to `workflowActions`. Custom components can call the
actions, the operations and the reads with `temporalApiRef`
(`runWorkflowAction`, `signalWorkflow`, `getWorkflow`, …).
The development apps have an example (`packages/backend/src/escalateAction.ts`).

Backend modules can teach the backend the model calls of another framework
with `temporalLlmAdapterExtensionPoint.addLlmAdapter()` (`./alpha`; see
[Model calls and tool calls](#model-calls-and-tool-calls)). Adapters added
this way are asked before the built-in ones; an ID that is taken fails the
backend start. An adapter that throws, or returns something of the wrong
shape, makes that step a plain step and logs a warning.
[Public interfaces](docs/public-interfaces.md#llm-adapters) has a minimal
adapter.

The other backend code that only needs Temporal uses the shared connection
of the backend plugin, without its routes:

```ts
import { temporalServiceRef } from '@kwkevinchan/backstage-plugin-temporal-backend/node';

env.registerInit({
  deps: { temporal: temporalServiceRef },
  async init({ temporal }) {
    const client = await temporal.getClient({ namespace: 'default' });
    // client.workflow.start(...), client.workflow.list(...)
  },
});
```

The entry points for modules (`./node`, `./alpha`, `./common`) do not load
the plugin itself. Importing a backend plugin package from a module makes
the Backstage lint rule `@backstage/no-mixed-plugin-imports` print a
warning; it does not fail the lint.

| What                                                          | Import from                                              |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `temporalServiceRef` and its type                             | `@kwkevinchan/backstage-plugin-temporal-backend/node`    |
| `temporalAccessServiceRef`, the extension points, …           | `@kwkevinchan/backstage-plugin-temporal-backend/alpha`   |
| Permissions, API types and paths, annotations (backend code)  | `@kwkevinchan/backstage-plugin-temporal-backend/common`  |
| Permissions, API types and paths, annotations (frontend code) | `@kwkevinchan/backstage-plugin-temporal-frontend/common` |
| `TemporalControlActionBlueprint`                              | `@kwkevinchan/backstage-plugin-temporal-frontend/alpha`  |
| `createTemporalControlActionDef`                              | `@kwkevinchan/backstage-plugin-temporal-frontend`        |

## Security

- **Secrets stay in the backend.** The Temporal token
  (`connection.auth.token`) and the S3 credentials are marked as secrets in
  the config schema and are never sent to the browser. Read them from
  environment variables or mounted secrets, not from files in git.
- **Access is open by default, operations included.** The operations that
  change workflows are on by default (`temporal.control.enabled`). With the
  allow-all policy, or with the permission framework off, every signed-in
  user can read every workflow of the configured namespaces (including
  inputs and results) and start, cancel and terminate workflows.
  `control.allowedSignals` and `control.allowedUpdates` only limit the
  names of signals and updates; they do not stop cancel or terminate.
  Write a permission policy before you enable the plugin for people who
  should not have that (see [Permissions](#permissions)), or set
  `temporal.control.enabled: false` to keep the plugin read-only.
- **Inputs and results can contain personal or secret data.** They are part
  of the history and need `temporal.workflow.history.read`; without it the
  graph is shown without them. The summaries of the steps and the labels of
  event groups are shown with `temporal.workflow.read` alone: do not put
  secrets into them. Keep the list permissions
  (`temporal.workflow.list`, `.history.list`) for people who may read every
  workflow.
- **Least privilege towards Temporal and S3.** The token only needs the read
  role on the namespaces in `connection.namespaces` (plus the write role if
  you use the operations). List only the namespaces Backstage should see.
- **The S3 credentials of External Storage are only for the plugin.** Give
  them `s3:GetObject` on the payload bucket
  (`arn:aws:s3:::temporal-payloads/*`) and nothing else; not
  `s3:ListBucket`, which would let a holder find the keys. Do not put the
  same access key or role in `integrations.awsS3`, and do not make it the
  main AWS account (`aws.mainAccount`, or the machine's role when that is
  unset): Backstage's URL reader reads with those, and the catalog, the
  Scaffolder and the Definition tab of the Zigflow module use it to read
  URLs that users give, without the permission checks of this plugin. The
  same holds for `defaultCredentials: true` when `aws.mainAccount` is not
  set: the URL reader also reads with the machine's role. An `accountId`
  entry without its own role or access key would do the same, and the
  backend refuses to start with it. A codec that encrypts payloads in the workers
  limits what a leaked object shows.
- **TLS is off by default.** Without `connection.tls: true`, a bearer token
  (`auth.type: bearer`) is sent without TLS, for a Temporal server inside a
  private network. Turn TLS on for any server across an untrusted network.
- **Operations are recorded.** Every operation is checked with the
  permission framework and recorded with the auditor, and the Temporal
  history shows the user as the identity. Limit signal and update names
  with `control.allowedSignals` and `control.allowedUpdates`, or turn the
  operations off with `control.enabled: false`.
- **Downloads are checked.** A payload can only be downloaded when its key
  belongs to a reference in the history of the run that names the
  configured bucket and driver; its SHA-256 is checked before anything is
  sent. No presigned URLs are handed out.
- **Images from S3** are shown from `blob:` URLs; allow `blob:` in
  `img-src` only (see [Installation](#backend)).

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Development

Requirements: Node.js 22 or 24, Yarn 4 through Corepack, and Docker or the
Temporal CLI for a local Temporal server.

```sh
corepack enable
yarn install

yarn start        # legacy frontend app + backend
yarn start:next   # new frontend system app + backend

yarn tsc          # type check
yarn lint:all     # lint
yarn test         # unit tests
yarn build:all    # build every package
yarn constraints  # dependency rules (yarn.config.cjs)
yarn boundaries   # boundary scan of tracked files
```

The frontend runs on <http://localhost:3000> and the backend on
<http://localhost:7007>. Put local overrides in `app-config.local.yaml`, which is
ignored by git.

The development backend expects a Temporal server on `localhost:7233` (for
example `temporal server start-dev --search-attribute BackstageEntityRef=Keyword --search-attribute BackstageInitiator=Keyword --search-attribute ApprovalPending=Bool`).
Start the example workflows for the `example-orders` component with:

```sh
yarn workspace example-worker start
```

Large payloads: the backend (with `app-config.s3.yaml`) and the example worker
need the same `PAYLOAD_S3_*` variables and a local RustFS (an S3-compatible
store) on port 9100. The worker then uses Temporal External Storage
(threshold 128 KiB) and also runs `reportWorkflow`, with about 1 MB of JSON,
180 KiB of JSON and a PNG as outputs. Stop a running `yarn start` and a
running example worker first (Ctrl+C in their terminals; the backend would
otherwise find port 7007 taken, and the old worker has no S3 configuration).
Keep the Temporal server. In every terminal below, set the variables first;
the compose file refuses to start without the access key and the secret key:

```sh
export PAYLOAD_S3_ENDPOINT=http://localhost:9100 PAYLOAD_S3_BUCKET=temporal-payloads
export PAYLOAD_S3_ACCESS_KEY=dev-access PAYLOAD_S3_SECRET_KEY=dev-secret-key
docker compose -f examples/docker-compose.rustfs.yaml up -d

# Frontend and backend; the paths are relative to packages/app and
# packages/backend. Use start:next for the new frontend system app. With
# --config, only the listed files are read: if you keep local settings in
# app-config.local.yaml, add --config ../../app-config.local.yaml.
yarn start --config ../../app-config.yaml --config ../../app-config.s3.yaml

# In another terminal, with the same variables exported:
yarn workspace example-worker start
```

`yarn workspace example-worker start` creates the bucket when it is missing,
runs the example workflows until the finished ones complete, and then exits;
the approval and deployment workflows stay open. When it has exited, the
External Storage smoke test, which only reads the history and needs no worker,
runs with `SMOKE_S3=1 yarn test:e2e e2e-tests/payloads.test.ts`. To operate workflows from
Backstage afterwards, run `yarn workspace example-worker serve` with the same
variables. When you are done, stop `yarn start` and the worker, and stop
RustFS with the variables set (`-v` also deletes the stored objects):

```sh
docker compose -f examples/docker-compose.rustfs.yaml down -v
```

The example worker also runs two loops: `draftReviewWorkflow` (draft,
review, revise until the score is high enough; done in round 4 of 5) and
`longRefineWorkflow` (25 rounds that continue as new every 10 rounds), and
two fake LLM agents without a model: `agentWorkflow` (four rounds of model
call and tools with loop markers, a retried tool, a local activity, and a
long answer stored in S3 when the worker uses it) and `mixedAgentWorkflow`
(ordinary activities, model calls, two tools in parallel and a child
workflow).

The YAML example workflows (`examples/workflows`, shown on the Definition
tab of `example-yaml-order-workflow`) run in Zigflow. Start a Zigflow worker
with the files, then the runs (the command also runs the worker of their
activities until the runs are done):

```sh
docker run -d --name zigflow --network host \
  -e TEMPORAL_ADDRESS=localhost:7233 -e DISABLE_TELEMETRY=true \
  -e CONVERT_FAILURE_DATA=false -e WORKFLOW_FILE= \
  -e WORKFLOW_DIRECTORY=/app/workflows \
  -v "$PWD/examples/workflows:/app/workflows:ro" \
  ghcr.io/zigflow/zigflow:0.18.0-core \
  run --health-listen-address 127.0.0.1:3901 --metrics-listen-address 127.0.0.1:9901
yarn workspace example-worker zigflow
SMOKE_ZIGFLOW=1 yarn test:e2e   # adds the run on the Definition tab
```

Signals, updates, queries and workflows started from Backstage need a running
worker; this one keeps polling until Ctrl+C:

```sh
yarn workspace example-worker serve
```

Smoke tests sign in as the guest user, open the Temporal tab, open a failed
workflow, select the failed step in the graph and check its input and error,
switch to the grouped events, open a running workflow, a `TemporalWorkflow`
entity and its runs, a component that depends on workflow entities, and the
Workflows page from the sidebar, and save a screenshot of every step. A
second test takes the details page in the dark theme. The control tests
(`e2e-tests/workflow-controls.test.ts`, with `example-worker serve` running) start a
ticket workflow, signal, query and update it, run the custom Escalate
action, cancel it, rerun it and terminate the rerun, in both themes. The
loop tests (`e2e-tests/loops.test.ts`) open both loop workflows, expand a
loop, step through its rounds and use the Loops tab, in both themes:

```sh
npx playwright install chromium
yarn test:e2e        # legacy frontend app
yarn test:e2e:next   # new frontend system app
```

Dependency versions of `@backstage/*` packages use the `backstage:^` range,
resolved from the release in `backstage.json` by the Backstage Yarn plugin.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## License

Copyright The backstage-plugin-temporal Authors.

Licensed under the [Apache License, Version 2.0](LICENSE).
