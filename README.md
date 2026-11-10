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
- **Loops of AI workflows.** Rounds of generate, check and revise loops are
  grouped into one box in the graph (expanded: one frame per round), one
  group per round in the timeline,
  and one row per round in the **Loops** tab, across continue-as-new runs
  (with `@kwkevinchan/temporal-workflow-kit/loop`, see
  [the workflow kit](plugins/temporal-workflow-kit)).
- **LLM steps of agent workflows.** Each model call is a box with the
  model, tokens, duration and number of tools; the tools it asked for hang
  off it. Its panel shows the input, the thinking, the output, the tool
  calls and the usage. The records follow the OpenTelemetry GenAI
  conventions (with `@kwkevinchan/temporal-workflow-kit/llm`, see
  [LLM steps](#llm-steps)).
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

| Workflows of an entity                                           | Step graph and step panel                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| ![Workflow list of an entity](docs/images/entity-tab.png)        | ![Step graph with the step panel](docs/images/details-graph.png) |
| **Timeline**                                                     | **Loop rounds**                                                  |
| ![Timeline of a loop workflow](docs/images/timeline.png)         | ![A loop expanded, one frame per round](docs/images/loop.png)    |
| **Large payload in S3**                                          | **Workflow controls**                                            |
| ![An image stored in S3](docs/images/s3-payload.png)             | ![Terminate dialog](docs/images/controls.png)                    |
| **A model call and its tool calls**                              | **LLM panel**                                                    |
| ![A model call with three tool calls](docs/images/llm-graph.png) | ![LLM panel of a model call](docs/images/llm-panel.png)          |

## Packages

| Package                                                                                                    | Role                   | Install in        | Purpose                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kwkevinchan/backstage-plugin-temporal`](plugins/temporal)                                               | frontend-plugin        | Backstage app     | Entity tab, workflow details, Workflows page. Legacy entry point; `./alpha` for the new frontend system with the blueprints for workflow actions, list actions and sections; `./ui` for companion packages. |
| [`@kwkevinchan/backstage-plugin-temporal-backend`](plugins/temporal-backend)                               | backend-plugin         | Backstage backend | REST API under `/api/temporal`: read workflows, queries, permission checks.                                                                                                                                 |
| [`@kwkevinchan/backstage-plugin-temporal-backend-module-control`](plugins/temporal-backend-module-control) | backend-plugin-module  | Backstage backend | Start, signal, update, cancel, terminate, rerun and custom actions (optional; without it the plugin only reads).                                                                                            |
| [`@kwkevinchan/backstage-plugin-temporal-module-control`](plugins/temporal-module-control)                 | frontend-plugin-module | Backstage app     | The buttons and dialogs of those operations, with the backend module above (optional).                                                                                                                      |
| [`@kwkevinchan/backstage-plugin-temporal-common`](plugins/temporal-common)                                 | common-library         | (dependency)      | Permissions, API types, annotation constants and the `TemporalWorkflow` kind. Import it in permission policies and modules.                                                                                 |
| [`@kwkevinchan/backstage-plugin-temporal-node`](plugins/temporal-node)                                     | node-library           | (dependency)      | `temporalServiceRef` (shared Temporal client) and `temporalExtensionPoint`, for backend modules.                                                                                                            |
| [`@kwkevinchan/backstage-plugin-catalog-backend-module-temporal`](plugins/catalog-backend-module-temporal) | backend-plugin-module  | Backstage backend | Catalog module with the `TemporalWorkflow` kind (optional).                                                                                                                                                 |
| [`@kwkevinchan/backstage-plugin-temporal-module-zigflow`](plugins/temporal-module-zigflow)                 | frontend-plugin-module | Backstage app     | Definition tab for workflows written in YAML and run by Zigflow (optional).                                                                                                                                 |
| [`@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`](plugins/temporal-backend-module-zigflow) | backend-plugin-module  | Backstage backend | Reads the definition files for that tab (optional, with the module above).                                                                                                                                  |
| [`@kwkevinchan/temporal-workflow-kit`](plugins/temporal-workflow-kit)                                      | node-library           | Your workers      | Not a Backstage package. `/loop`: loop markers, a loop state query and continue-as-new helpers. `/llm`: records of model calls (OpenTelemetry GenAI).                                                       |

Which ones to install:

- **Everyone:** the frontend plugin in the app and the backend plugin in the
  backend.
- **With `TemporalWorkflow` entities:** also the catalog module in the
  backend.
- **With loops or LLM steps of AI workflows:** the workflow kit in your
  Temporal workers (not in Backstage).
- **To start, signal, update, cancel, terminate or rerun workflows from
  Backstage:** the two control modules (frontend and backend). Without them
  the plugin only reads; Query is in the core plugin.
- **With workflows written in YAML for Zigflow:** the two Zigflow modules
  (frontend and backend) for the Definition tab.
- **With large payloads in External Storage:** nothing more; the backend
  reads the references itself and only needs `temporal.externalStorage.s3`.

Plugins and app modules that add buttons or tabs to the workflow page use the
frontend plugin (`./alpha` for the blueprints); backend modules use
`-node`, and permission policies the permissions of `-common`.

Development-only packages (never published): `packages/app` (legacy frontend
system), `packages/app-next` (new frontend system), `packages/backend` and
`packages/example-worker`.

## Compatibility

| Component       | Supported                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backstage       | **1.56.x** only (see `backstage.json`). Both frontend systems: legacy (`EntityPage.tsx`) and new (`./alpha`).                                                                                                                                                                                                                                    |
| Temporal server | Tested with **1.32** (self-hosted, and the development server of the Temporal CLI 1.9).                                                                                                                                                                                                                                                          |
| Temporal SDK    | The backend uses `@temporalio/client` **1.24**; a new major of it is a new major of the plugin packages. `@kwkevinchan/temporal-workflow-kit/loop` needs `@temporalio/workflow` 1.12 or later (tested with 1.24); Large payloads: Temporal External Storage with the S3 driver (TypeScript SDK 1.21 or later, tested with 1.24; public preview). |
| Node.js         | 22 or 24.                                                                                                                                                                                                                                                                                                                                        |

The screens use the Backstage design system `@backstage/ui`; the app must
load its styles (`import '@backstage/ui/css/styles.css'`, as apps created for
1.56 do). Light and dark themes follow the app theme. The step graph uses
[React Flow](https://reactflow.dev) (`@xyflow/react`) with the
[dagre](https://github.com/dagrejs/dagre) layout, both MIT licensed; the
timeline is drawn with plain HTML and CSS.
The backend parses YAML with [`yaml`](https://eemeli.org/yaml/) (ISC).

## Installation

### Backend

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend
# Optional: the TemporalWorkflow kind.
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-catalog-backend-module-temporal
```

`packages/backend/src/index.ts`:

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
// Optional: start, signal, update, cancel, terminate, rerun and custom
// actions. Without it the plugin only reads.
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-control'),
);
// Optional: the TemporalWorkflow kind.
backend.add(
  import('@kwkevinchan/backstage-plugin-catalog-backend-module-temporal'),
);
```

The backend plugin needs the catalog and the permission framework. It only
uses `@temporalio/client` (no worker code runs inside Backstage). Add at
least `temporal.connection` to your app config (see
[Configuration](#configuration)).

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
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal
```

Add the plugin to your app features, or let feature discovery find it:

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal/alpha';

export default createApp({ features: [temporalPlugin /* ... */] });
```

This adds a **Temporal** tab to entities of any kind that have Temporal
annotations, to `TemporalWorkflow` entities and to entities that depend on
them; a summary card on the overview of `TemporalWorkflow` entities; a card
with the workflow entities on the overview of entities that depend on them;
and the **Workflows** page on `/temporal`. The page has a title and an icon,
so the app lists it in the sidebar with the nav items it discovers from pages
(`navItems` of `NavContentBlueprint`).

With the backend control module, add the frontend control module for the
buttons of the operations (Signal, Update, Cancel, Terminate, Rerun and
Start workflow):

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-module-control
```

```ts
import temporalControlModule from '@kwkevinchan/backstage-plugin-temporal-module-control/alpha';

export default createApp({
  features: [temporalPlugin, temporalControlModule /* ... */],
});
```

### Frontend, legacy frontend system

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal
```

`EntityPage.tsx`:

```tsx
import {
  EntityTemporalContent,
  isTemporalAvailable,
} from '@kwkevinchan/backstage-plugin-temporal';

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
} from '@kwkevinchan/backstage-plugin-temporal';

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
`if={e => getDependsOnTemporalWorkflowRefs(e).length > 0}`), and
`EntityTemporalWorkflowStatsCard` shows the recent run statistics on its own.

The Workflows page (`App.tsx` and the sidebar in `Root.tsx`):

```tsx
import { TemporalPage } from '@kwkevinchan/backstage-plugin-temporal';
import AccountTreeIcon from '@material-ui/icons/AccountTree';

<Route path="/temporal" element={<TemporalPage />} />;

<SidebarItem icon={AccountTreeIcon} to="temporal" text="Workflows" />;
```

With the backend control module, add the frontend control module
(`yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-module-control`)
and pass its buttons to the props of the entity tab and the Workflows page.
Its API factory in `apis.ts` is optional: without it the buttons use the
default client.

```tsx
import {
  temporalControlApiFactory,
  temporalControlListActions,
  temporalControlWorkflowActions,
} from '@kwkevinchan/backstage-plugin-temporal-module-control';

// apis.ts, optional: without it the buttons use the default client
export const apis = [/* ... */ temporalControlApiFactory];

<EntityTemporalContent
  workflowActions={temporalControlWorkflowActions}
  workflowListActions={temporalControlListActions}
/>;
<TemporalPage
  workflowActions={temporalControlWorkflowActions}
  workflowListActions={temporalControlListActions}
/>;
```

## Workflow details

The details page of a run shows, from top to bottom:

- a header: the workflow ID and the run ID, with the actions on the right
  (controls, your own actions, the link to the Temporal UI, a refresh
  button and, for running workflows, **Auto refresh**). Below a line, the
  fields in a grid: status, where the run is now (what it waits for, or the
  step it failed at), the run of the execution chain (`Run 2 of 3`, with
  links to the run before and after and an explanation of continue-as-new),
  workflow type, duration and start time. Running workflows reload every
  five seconds; the **Auto refresh** switch turns this off.
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

## LLM steps

LLM agents call a model, run the tools it asks for, and call it again. When
the activity of each model call returns a record of the call and the
activities of the tools carry a marker (see
[`@kwkevinchan/temporal-workflow-kit`](plugins/temporal-workflow-kit#llm-llm-steps-of-agent-workflows)
for the format, a TypeScript recorder and converters for OpenAI, Anthropic
and Ollama, `/llm`):

- the graph draws a model call as a larger box with the model, the input and
  output tokens, the duration and the number of tools. The tool calls it
  asked for are smaller boxes with the tool name, joined to it by dashed
  arrows, so an agent loop reads as model call, tools, model call. Retries
  of a tool show on its box.
- selecting a model call opens the LLM panel: **Input** (system
  instructions and messages as a chat, long texts collapsed), **Thinking**
  (collapsed), **Output**, **Tool calls** (name, arguments, response,
  status, and a button to the step of the tool) and **Usage** (input,
  output, reasoning and cached tokens, duration). Every section has a copy
  button; **Raw JSON** shows the record as the worker wrote it. A tool step
  links back to its model call.
- the **Loops** tab adds the tokens of each round and of the loop, and marks
  model and tool calls; the **Timeline** marks them too.

The format:

- activity ID `llm/<call>[/...]` for a model call and
  `tool/<call>/<tool call ID>[/...]` for a tool call; a loop marker may
  follow (`llm/r2/loop/agent/2/callModel`). Read without the payload codec.
- the result of a model call holds the record under `temporal.llm`: the
  attributes of the
  [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
  (`gen_ai.request.model`, `gen_ai.usage.input_tokens`,
  `gen_ai.input.messages`, `gen_ai.output.messages` with parts `text`,
  `reasoning`, `tool_call`, `tool_call_response`, ...), version
  `gen-ai-dev/1.42.0-dev`. Large records go to External Storage like any payload.

The graph, the Loops tab and the timeline need the read permission and show
names and numbers only (model, tokens, tool names). The messages, the
thinking and tool arguments and results need
`temporal.workflow.history.read`, like inputs and results
(`GET .../llm-calls/:eventId`). Workflows without markers look as before.

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

```yaml
temporal:
  connection:
    # Temporal frontend service, host:port.
    address: temporal-frontend.temporal.svc:7233
    # Namespaces the plugin may read; requests for others are rejected.
    # Default: [default].
    namespaces: [default, orders]
    # Namespace of entities without temporal.io/namespace. Default: default.
    defaultNamespace: default
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
  # Optional (control module): limit the signals and updates that may be sent.
  control:
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
```

| Key                                 | Default        | Meaning                                                                                                |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `connection.address`                | (required)     | Temporal frontend service, `host:port`.                                                                |
| `connection.namespaces`             | `[default]`    | Namespaces the plugin may read. The UI uses one namespace per entity; the API takes it as a parameter. |
| `connection.defaultNamespace`       | `default`      | Namespace of entities without `temporal.io/namespace` or `spec.namespace`.                             |
| `connection.auth.type`              | `none`         | `none`, or `bearer` to send `Authorization: Bearer <token>`.                                           |
| `connection.auth.token`             |                | Token for `bearer`. A secret: read it from an environment variable.                                    |
| `webUi.baseUrl`                     |                | Temporal Web UI; adds "Open in Temporal UI" links.                                                     |
| `searchAttributes.entityRef`        |                | Keyword search attribute with the entity reference of a workflow.                                      |
| `searchAttributes.initiator`        |                | Keyword search attribute set to the user who started or reran a workflow from Backstage.               |
| `control.allowedSignals`            | (all)          | Signal names that may be sent.                                                                         |
| `control.allowedUpdates`            | (all)          | Update names that may be sent.                                                                         |
| `externalStorage.s3.bucket`         | (required)     | Bucket the workers store payloads in.                                                                  |
| `externalStorage.s3.driverName`     | `aws.s3driver` | Driver name the workers' S3 driver writes (`driverName` of `S3StorageDriver`).                         |
| `externalStorage.s3.endpoint`       | AWS S3         | Endpoint of an S3-compatible service.                                                                  |
| `externalStorage.s3.region`         | `us-east-1`    | Region.                                                                                                |
| `externalStorage.s3.forcePathStyle` | `false`        | Bucket in the path instead of the host name (most self-hosted services).                               |
| `externalStorage.s3.credentials`    | (required)     | `accessKeyId`, `secretAccessKey` and optional `sessionToken`, with read access (`s3:GetObject`).       |
| `externalStorage.s3.maxInlineBytes` | `262144`       | JSON payloads up to this size are shown like payloads in the history.                                  |
| `externalStorage.s3.previewBytes`   | `2048`         | Bytes of text shown as the preview of a larger payload.                                                |

All keys are under `temporal`. The frontend reads `connection.defaultNamespace`,
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
environment variable or a mounted secret. The connection does not use TLS,
for a Temporal server inside a private network. The plugin passes the token
as the `apiKey` connection option of `@temporalio/client` and turns TLS off,
which the client otherwise turns on for an API key.

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
same bucket (and allow `blob:` images, see [Installation](#backend)):

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
  50 MiB, missing, or not matching its SHA-256: the error.

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

The catalog module adds the `TemporalWorkflow` kind. One entity stands for
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

| Permission                       | Resource type       | Used for                                                         |
| -------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `temporal.workflow.read`         | `catalog-entity`    | Workflow list, details, step graph, progress, Zigflow definition |
| `temporal.workflow.history.read` | `catalog-entity`    | Event history, inputs and results                                |
| `temporal.workflow.list`         | `temporal-workflow` | Workflows page; details and step graph without an entity         |
| `temporal.workflow.history.list` | `temporal-workflow` | Event history, inputs and results without an entity              |
| `temporal.workflow.query`        | `catalog-entity`    | Run a query chosen by the user (the Query dialog)                |
| `temporal.workflow.start`        | `catalog-entity`    | Start a workflow of the entity, or from the Workflows page       |
| `temporal.workflow.signal`       | `catalog-entity`    | Send a signal                                                    |
| `temporal.workflow.update`       | `catalog-entity`    | Send an update (also used by the example custom action)          |
| `temporal.workflow.cancel`       | `catalog-entity`    | Ask a running workflow to cancel                                 |
| `temporal.workflow.terminate`    | `catalog-entity`    | Terminate a running workflow, with a reason                      |
| `temporal.workflow.rerun`        | `catalog-entity`    | Start a run again with the same input                            |

The plugin registers the permissions and checks them on every request. The
entity permissions use the entity as the resource. `temporal.workflow.list`
allows the Workflows page, which lists the workflows of the allowed
namespaces, and opening the details and the step graph of any of them
without an entity. Their event history, inputs and results also need
`temporal.workflow.history.list`. Both are resource permissions on the
`temporal-workflow` resource type (a workflow): a policy can allow them,
deny them, or return a conditional decision. The plugin ships no rules for
this type yet; a backend module can add some with
`coreServices.permissionsRegistry.addPermissionRules` and
`temporalWorkflowPermissionResourceRef` from
`@kwkevinchan/backstage-plugin-temporal-node/alpha`. Each rule's `toQuery`
returns a Temporal visibility query, which is added to the list query
(`allOf` with AND, `anyOf` with OR; `not` is refused). An unconditional
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

## Workflow controls

The operations that change workflows come from the control modules: the
routes from `@kwkevinchan/backstage-plugin-temporal-backend-module-control`,
the buttons from `@kwkevinchan/backstage-plugin-temporal-module-control`.
Without them the backend has no such routes and the pages only read. Query
stays in the core plugin and needs `temporal.workflow.query`.

The details page has an action bar with the operations that fit the run:

- running: **Signal…**, **Update…**, **Cancel** and **Terminate**;
- closed: **Rerun**;
- always: **Query…** (core plugin).

Cancel and Terminate ask for confirmation; Terminate needs a reason, which is
kept in the history. Rerun starts a new workflow with the input, workflow
type, task queue, memo, timeouts, retry policy and search attributes of the
run's start event, under a new workflow ID, and opens it. The Signal, Update
and Query dialogs offer the names the workflow defines (read with the
`__temporal_workflow_metadata` query of the Temporal SDKs; any name can be
typed; the backend lists them at `GET .../handlers`), take the arguments as
JSON and show the result or the error, for example the message of an update
validator.

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
also needs `temporal.workflow.list`. Queries only read the workflow; they
need `temporal.workflow.query` besides the read permission. Denied requests answer 403. Each operation is recorded
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
} from '@kwkevinchan/backstage-plugin-temporal-common';

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

## Extending

New frontend system, with the blueprints of
`@kwkevinchan/backstage-plugin-temporal/alpha`:

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
the shared mount point `api:temporal/workflow-extensions`
(`temporalWorkflowExtensionsApiRef`), so they show on the pages of the
entity tab and of the Workflows page. In the legacy system, pass
`workflowActions`, `workflowSections` and `workflowListActions` to
`EntityTemporalContent` and to `TemporalPage`. Components get the workflow as props or through
`useTemporalWorkflow()`.

Backend modules that serve their own routes under `/api/temporal` use the
plugin's access checks through `temporalAccessServiceRef`
(`@kwkevinchan/backstage-plugin-temporal-node/alpha`). To decide access in
another way, add your own factory for that ref to the backend; the default
factory that the backend package brings is then skipped.

Backend modules can add data to workflow summaries with
`temporalExtensionPoint.addWorkflowEnricher()` from
`@kwkevinchan/backstage-plugin-temporal-node`, and, with the control module
installed, custom workflow actions with
`temporalControlExtensionPoint.addControlAction()` from
`@kwkevinchan/backstage-plugin-temporal-node/alpha`. An action is served as
`POST .../actions/:actionId`; the backend reads the workflow, checks the
action's permission on its entity, runs the optional `filter`, records the
call with the auditor and passes a Temporal client to `handle`:

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

The frontend control module shows it as a button that runs the action and
shows the result. New frontend system, with the blueprint of
`@kwkevinchan/backstage-plugin-temporal-module-control/alpha`:

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
of the same package to `workflowActions`. Custom components can call the
actions and the operations with `temporalControlApiRef`
(`runWorkflowAction`, `signalWorkflow`, …), and the reads and queries with
`temporalApiRef`.
The development apps have an example (`packages/backend/src/escalateAction.ts`).

## Security

- **Secrets stay in the backend.** The Temporal token
  (`connection.auth.token`) and the S3 credentials are marked as secrets in
  the config schema and are never sent to the browser. Read them from
  environment variables or mounted secrets, not from files in git.
- **Access is open by default.** With the allow-all policy, or with the
  permission framework off, every signed-in user can read every workflow
  of the configured namespaces (including inputs and results) and use
  every operation. Write a permission policy before you enable the plugin
  for people who should not have that (see [Permissions](#permissions)).
- **Inputs and results can contain personal or secret data.** They are part
  of the history and need `temporal.workflow.history.read`; without it the
  graph is shown without them. Keep the list permissions
  (`temporal.workflow.list`, `.history.list`) for people who may read every
  workflow.
- **Least privilege towards Temporal and S3.** The token only needs the read
  role on the namespaces in `connection.namespaces` (plus the write role if
  you use the operations); the S3 key only needs `s3:GetObject` on the
  payload bucket. List only the namespaces Backstage should see.
- **No TLS on the Temporal connection.** `auth.type: bearer` sends the token
  without TLS, for a Temporal server inside a private network. Do not point
  it at a server across an untrusted network.
- **Operations are recorded.** Every operation is checked with the
  permission framework and recorded with the auditor, and the Temporal
  history shows the user as the identity. Limit signal and update names
  with `control.allowedSignals` and `control.allowedUpdates`, or leave
  the control module out to keep the plugin read-only.
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

Large payloads: start RustFS (an S3-compatible store) on port 9100, then the
backend with `app-config.s3.yaml` and the example worker with the same
`PAYLOAD_S3_*` variables. The worker then uses Temporal External Storage
(threshold 128 KiB) and also runs `reportWorkflow`, with about 1 MB of JSON,
180 KiB of JSON and a PNG as outputs:

```sh
export PAYLOAD_S3_ENDPOINT=http://localhost:9100 PAYLOAD_S3_BUCKET=temporal-payloads
export PAYLOAD_S3_ACCESS_KEY=dev-access PAYLOAD_S3_SECRET_KEY=dev-secret-key
docker compose -f examples/docker-compose.rustfs.yaml up -d
yarn workspace backend start --config ../../app-config.yaml --config ../../app-config.s3.yaml
yarn workspace example-worker start
SMOKE_S3=1 yarn test:e2e   # adds the External Storage smoke test
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
