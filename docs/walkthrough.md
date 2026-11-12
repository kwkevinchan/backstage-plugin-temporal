# Walkthrough

English | [繁體中文](zh-TW/walkthrough.md)

This guide takes you through the plugin on your own machine, with the
development app and the example worker of this repository. It answers: what do
the screens show, and what happens when you operate a workflow? Allow about two
hours. You will meet the core Temporal concepts and every screen and operation
of the plugin, and you will know where to look when something is wrong. Each step
says what to look at and why.

Everything here uses only what is in this repository: the development apps
(`packages/app`, `packages/app-next`, `packages/backend`), the example worker
(`packages/example-worker`), the catalog entities in `examples/entities.yaml`
and, optionally, the Docker Compose file in `examples/`. Where a step needs
Docker, it says so and is optional.

- [0. Before you start](#0-before-you-start)
- [1. Start the environment](#1-start-the-environment)
- [2. Find workflows in the catalog](#2-find-workflows-in-the-catalog)
- [3. Read a run](#3-read-a-run)
- [4. Operate running workflows](#4-operate-running-workflows)
- [5. Long workflows, child workflows, large data](#5-long-workflows-child-workflows-large-data)
- [6. Workflow definitions in YAML (optional)](#6-workflow-definitions-in-yaml-optional)
- [7. AI workflows (experimental)](#7-ai-workflows-experimental)
- [8. The Temporal side](#8-the-temporal-side)
- [9. Automated checks and clean-up](#9-automated-checks-and-clean-up)
- [What you should be able to do afterwards](#what-you-should-be-able-to-do-afterwards)

## 0. Before you start

Read, in about 20 minutes, the [Temporal primer](temporal-primer.md) up to
"Core concepts". You only need the difference between Workflow Type, Workflow
Execution, Event History, Activity, Signal, Query and Update; the rest comes from
doing. [From Temporal concepts to the plugin](concepts-to-plugin.md) is the
reference to keep open.

You need Node.js 22 or 24, Yarn 4 through Corepack, and the
[Temporal CLI](https://docs.temporal.io/cli) for a local Temporal server (or
Docker; see the [README's Development section](../README.md#development)). The
whole setup is a Temporal development server, a Backstage backend and frontend,
and a worker; it is light enough for a laptop, but do not run it next to heavy
builds.

## 1. Start the environment

1. Install the dependencies:

   ```sh
   corepack enable
   yarn install
   ```

2. Start a Temporal development server, with the search attributes the plugin and
   the example worker use:

   ```sh
   temporal server start-dev \
     --search-attribute BackstageEntityRef=Keyword \
     --search-attribute BackstageInitiator=Keyword \
     --search-attribute ApprovalPending=Bool
   ```

   It listens on `localhost:7233`, which is what `app-config.yaml` expects. Its
   Web UI is on <http://localhost:8233> by default; the development config links
   to `http://localhost:8080`, so set `TEMPORAL_UI_URL=http://localhost:8233` for
   the next command if you want **Open in Temporal UI** to work.

3. In a second terminal, start the app and the backend (`yarn start:next` starts
   the new frontend system app instead):

   ```sh
   yarn start
   ```

   Open <http://localhost:3000> and sign in as the guest user. The backend is on
   <http://localhost:7007>. The development backend allows every permission (the
   allow-all policy), so every button works.

4. In a third terminal, start the example workflows:

   ```sh
   yarn workspace example-worker start
   ```

   It starts a set of workflows for the `example-orders` component on the
   `backstage-example` task queue (successful, failed, running, with retries, a
   timer, a child workflow, loops and so on) and prints their workflow IDs. They
   look like `example-order-<suffix>`; the suffix is the start time in base 36.
   The command runs a worker until the finished ones complete, sends one
   `comment` signal to the approval workflow, waits for the deployment workflow to
   get a retrying activity, and then exits, after a few tens of seconds. The deployment
   and approval workflows stay open.

5. Signals, updates, queries and workflows started from Backstage need a worker
   that keeps polling. Keep this running in the third terminal (or a fourth) until
   you finish:

   ```sh
   yarn workspace example-worker serve
   ```

**What to look at:** the IDs printed in step 4, and that the command ends with
`deploymentWorkflow is running: …`. The next steps use them.

**Why:** the plugin only reads Temporal and sends it commands. It does not run
workflow code; the worker does. Without a worker, workflows do not advance and
operations that need a handler (update, query) time out.

## 2. Find workflows in the catalog

1. In Backstage, open **Catalog**. The list starts with the kind **Component**
   and shows the titles of the entities: **Example checkout service**,
   **Example orders service** (the entity `example-orders`) and `example-website`,
   which has no title. Set the kind filter to **TemporalWorkflow** to see the five
   workflow entities, for example **Example order workflow** and **Example ticket
   workflow**. One entity is one Workflow Type. (**Example order jobs** is a
   `Resource`; it appears under that kind.)
2. Open **Example order workflow**. Its **Overview** has a **Workflow type** card
   with the workflow type, task queue and namespace, and an **Open in Temporal UI**
   link. The tabs are **Overview**, **Temporal** and **Definition**.
3. Open **Example checkout service** and its **Temporal** tab. The entity lists
   `example-order-workflow` and `example-payment-workflow` in `spec.dependsOn`, so
   the tab shows a **Workflow types** card with both, and the executions of both,
   together with those matched by the entity's own annotations.
4. Compare with `example-website`, which has no Temporal annotations and no
   dependency: it has only the **Overview** tab. **Example order jobs** is a
   `Resource`, not a component, and still has a **Temporal** tab with only the
   order workflows: the plugin does not depend on the entity kind.

**Why:** the plugin finds "the workflows of this entity" from a `TemporalWorkflow`
entity or from `temporal.io/*` annotations. Open `examples/entities.yaml` next to
the UI to see the YAML behind each of these.
See [concepts](concepts-to-plugin.md#what-the-plugin-adds).

## 3. Read a run

Open **Example orders service** and its **Temporal** tab. It lists **Workflow
executions**.

![The Temporal tab of a component: a table of workflow executions with status, progress, start time and duration.](images/entity-tab.png)

1. **The list.** Look at the status (Completed, Failed, Running), the times and the
   progress column: the current step, or the step where it failed (for example
   `0/1 steps · Waiting for approval · times out in 23h 58m`, or `0/1 steps · Failed at
chargeCard`). Try the status filter and **Show all runs**; the URL changes with
   them, so the browser's back button returns to the same page.
2. **A failed run.** Open `example-payment-…`. The header shows the Workflow ID,
   the Run ID, the status and where it stopped (`Failed at chargeCard`). In the
   **Steps** graph the failed box is red; select it to see, in the panel on the
   right, the failure type and message (`CardDeclined`, `Card ending 4242 was
declined`), the attempt, the input and the output. The cause chain of the
   workflow's own failure (`PaymentFailed` caused by the activity failure caused
   by `CardDeclined`) is on the **Details** tab, under **Failure**.

   ![The details page of a failed run: header, step graph and the step panel with the error.](images/details-graph.png)

3. **Retries, parallel steps, a timer, a child.** Open `example-fulfillment-…`.
   Two activities (`pickItems`, `printLabel`) run in parallel, so the graph has two
   branches. `bookCourier` shows `×3`: it failed twice and succeeded on the third
   attempt. A **Timer 2s** box follows (the workflow sleeps; the Temporal server
   keeps the time), then a child workflow box, `notifyCustomerWorkflow`.
4. **Timeline.** On the same run, open the **Timeline** tab. Each activity has a
   light bar (waiting for a worker, including earlier attempts and the retry
   backoff) and a solid bar (the run that completed). Hover for times; drag across
   the chart to zoom.
5. **Events.** The **Grouped** view collapses the events of each step; **Raw** is
   the Event History as recorded (`WorkflowExecutionStarted`,
   `WorkflowTaskScheduled`, `ActivityTaskScheduled`, …). Turn on **Show workflow
   tasks** to see the internal events that are hidden by default.
6. **Details.** Look at the search attributes (`BackstageEntityRef` is how the
   plugin finds the workflow's entity), the memo and, for a running workflow,
   **Pending activities**. `example-deployment-…` has an activity, `waitForUpstream`,
   that keeps retrying.
7. **Compare.** Press **Open in Temporal UI** to see the same run in the Temporal
   Web UI (this needs `TEMPORAL_UI_URL` from step 1.3).

**Why:** every screen is computed from one Event History. If you can match the raw
events to the boxes, you understand
[the event history and replay](temporal-primer.md#what-an-execution-looks-like-in-the-event-history).

## 4. Operate running workflows

These steps need the worker from step 1.5 and use the control modules, which the
development apps install.

The page of a running workflow reloads every ten seconds while its browser tab is in
front; the **Auto refresh** switch turns that off. The **Raw** events are the
exception: they load when opened and again when you press **Refresh** (or finish an
action), or when the page moves to another run, not by the automatic reload. The **Refresh** button stays
locked until its reload has ended and at least a second has passed, so pressing it
repeatedly sends one request.

1. **A workflow that waits for approval.** Open `example-approval-…` (status
   Running). The progress column says **Waiting for approval · times out in …**:
   the workflow was started with the search attribute `ApprovalPending` set to
   true, and the plugin turns it into this text
   ([details](concepts-to-plugin.md#the-pending-search-attribute-convention)). The
   graph already has a `comment` Signal step: the command of step 1.4 sent one.
   - Press **Signal…**, keep the name `comment` and send the argument `"looks fine"`.
     The dialog says `Signal comment sent`, and the graph gains a second Signal
     step.
   - Press **Update…**; the name `approve` is filled in. Send `""`. The workflow's
     validator rejects it: the dialog shows `approver is required`, and the
     rejected update leaves **no** trace in the event history.
   - Send `approve` with `"alice"`. The dialog shows `Update approve done` and the
     result (`{"approvedBy":"alice"}`). The graph gains an Update step, the Timer
     24h box is marked **Canceled** (the wait ended before the timer did), and the
     workflow completes.
2. **A support ticket.** Open the **Example ticket workflow** entity, its
   **Temporal** tab, and press **Start workflow**. The dialog says `Starts
ticketWorkflow on task queue backstage-example` and the input is prefilled from
   the entity's `spec.exampleInput`. Press **Start**; the new run opens
   (`ticketWorkflow-<suffix>`) and says **Waiting for an external event (signal or
   update)**.
   - **Signal…** `addNote`: the dialog shows a form (**Note**, prefilled with
     `Called the customer`) from the entity's input schema.
   - **Query…** `state`: the result shows the title, the priority, the notes and
     the status. A query changes nothing and leaves nothing in the history.
   - **Update…** `setPriority` with `"high"` returns `{"previous":"normal","priority":"high"}`;
     with `"urgent"` the validator rejects it (`priority must be one of low,
normal, high`).
   - The **Escalate** button comes from a custom action registered in the
     development backend (`packages/backend/src/escalateAction.ts`); see
     [Extension points](architecture.md#extension-points). It asks `Raise the
priority of this ticket to high?` and then sets the priority to high.
   - Send the `close` signal: the workflow completes.
3. **Cancel and Terminate.** Start two more tickets with **Start workflow** (they
   run until closed). Press **Cancel** on one and confirm (**Cancel workflow**):
   the workflow gets the chance to react; this one has nothing to clean up, so its
   status becomes **Canceled**. Press **Terminate** on the other: a reason is
   required. After the confirmation the status is **Terminated**, the summary says
   `Stopped at: Terminated: <your reason>`, and the reason is also under **Failure**
   on the **Details** tab.
4. **Rerun.** Open a closed run and press **Rerun**, then confirm: a new workflow
   starts with the same input, type and task queue under a new Workflow ID
   (`<old ID>-rerun-<suffix>`), and opens.
5. **Who did it.** In the Temporal Web UI, the history events of these operations
   show the identity `backstage:user:default/guest`.

![The Terminate dialog.](images/controls.png)

**Why:** Signal, Update, Cancel and Terminate are written to the event history;
Query is not. In production you write a permission policy, because the
development backend allows everything; see
[Permissions](../README.md#permissions) and
[How it works](how-it-works.md#figure-1-one-request-through-the-layers).

## 5. Long workflows, child workflows, large data

1. **Continue-As-New.** The example worker starts `pollWorkflow`, which continues
   as new three times. Open its row: the header says `Run 4 of 4` with an ⓘ that
   explains it, and a link **← Run 3** goes to the run before. The earlier runs
   have the status **Continued as new**; turn on **Show all runs** on the list to
   see all four.
2. **Child workflows.** In `example-fulfillment-…`, select the child workflow box
   (`notifyCustomerWorkflow`): the step panel shows its input and output, and its
   **Workflow** field links to the child's own details page.
3. **Large payloads (optional, needs Docker).** Temporal can store large payloads
   in S3 and keep only a reference in the history. This needs a different
   configuration for the backend and the worker, so restart them. The README's
   [Development section](../README.md#development) lists the same commands in two
   blocks; here they are numbered, with the order that matters (stop, set the
   variables, RustFS, app and backend, worker):

   1. Stop what is running: the worker from step 1.5 (Ctrl+C) and `yarn start`
      (Ctrl+C; this stops the frontend and the backend). Keep the Temporal
      development server.
   2. In every terminal below, set the variables for a local RustFS:

      ```sh
      export PAYLOAD_S3_ENDPOINT=http://localhost:9100 PAYLOAD_S3_BUCKET=temporal-payloads
      export PAYLOAD_S3_ACCESS_KEY=dev-access PAYLOAD_S3_SECRET_KEY=dev-secret-key
      ```

   3. Start RustFS:
      `docker compose -f examples/docker-compose.rustfs.yaml up -d`.
   4. Start the app and the backend again, with the extra config file (the paths
      are relative to `packages/app` and `packages/backend`). Set
      `TEMPORAL_UI_URL` again as in step 1.3 if you use **Open in Temporal UI**:

      ```sh
      yarn start --config ../../app-config.yaml --config ../../app-config.s3.yaml
      ```

      Only the listed files are read: if you keep local settings in
      `app-config.local.yaml`, add `--config ../../app-config.local.yaml`.

   5. In another terminal run `yarn workspace example-worker start` with the same
      variables. It creates the bucket, starts a fresh set of workflows, now
      including `reportWorkflow`, and stores payloads above 128 KiB in S3. When it
      has exited, run `yarn workspace example-worker serve` with the same variables
      if you want to operate workflows again.

   Open `example-report-…` and select `buildReport` and `renderChart`. The output
   shows **Stored in S3**, the size and the media type: the JSON (1 MB) is larger
   than the inline limit, so the panel shows a short preview and a **Download**
   button, and the PNG chart (430 KB) has a **Download** button too.
   The plugin read the objects from S3 and checked their SHA-256. Stop RustFS when
   you are done (`docker compose -f examples/docker-compose.rustfs.yaml down -v`,
   with the variables set).

   ![A payload stored in S3, shown as an image.](images/s3-payload.png)

**Why:** the event history has a size limit, so long workflows continue as new and
big payloads go outside. See the primer's
[long-running workflows](temporal-primer.md#long-running-workflows).

## 6. Workflow definitions in YAML (optional)

The YAML examples run in [Zigflow](https://github.com/zigflow/zigflow), which needs
Docker. Follow the README's [Development section](../README.md#development) to
start the Zigflow container and run `yarn workspace example-worker zigflow` (it
starts two runs of the YAML workflow: one completes, one fails because nobody sends
`paymentReceived`). Then open the **Example YAML order workflow** entity and its
**Definition** tab. Above the YAML it says `./workflows/order-fulfillment.yaml`,
its size and the number of tasks:

1. The YAML (`examples/workflows/order-fulfillment.yaml`) is on the left, its
   graph on the right. Select a box and its lines are marked and scrolled to;
   select a line and the innermost task is selected.
2. **Show a run** is a choice that starts at `No run` and lists the recent runs
   (`Completed · example-yaml-order-…`, `Failed · example-yaml-unpaid-…`). Choose
   one: each box takes the colour of what happened (a task that ran more than once
   says how many times), and **Open the run** goes to its details page.
3. Compare with **Example order workflow**, written in code: its Definition tab
   says `This workflow is written in code` and links to the source (**View the
   file**) from its annotations.

![The Definition tab: the YAML next to its graph.](images/definition.png)

The tab belongs to two optional packages; see
[Workflow definitions](../README.md#workflow-definitions).

## 7. AI workflows (experimental)

The development app turns on `temporal.experimental.aiWorkflows`; the views are
off by default in your own app, will move to a separate package, and carry no
compatibility promise. The example worker starts fake AI workflows that call no
model.

1. **Loops.** `draftReviewWorkflow` drafts, reviews and revises until the score is
   high enough (done in round 4 of 5). The graph folds the loop into one box;
   expand it to see one frame per round. The **Loops** tab (shown only for
   workflows with loops) lists each round with its decision and score, newest
   first. `longRefineWorkflow` runs 25 rounds and continues as new every 10, so its
   rounds are counted across three runs (`Run 3 of 3`); it ends with `Round 25 of
25 · Out of rounds`, because the example never reaches its goal.

   ![A loop expanded, one frame per round.](images/loop.png)

2. **LLM steps.** In `example-agent-…` the loop is one box (`agent`); press
   **Expand**. Each model call (`callModel`, with the model, the tokens and the
   number of tools) is a box with its tools next to it; one tool (`read_file`)
   retries, and `glossary` runs as a local activity. Select a model call: the panel
   shows the input, the thinking, the output, the tool calls and the usage.
   `mixedAgentWorkflow` mixes ordinary activities, model calls, parallel tools and
   a child workflow.

   ![A model call with its tool calls.](images/llm-graph.png)

**Why:** Temporal only sees a series of activities. These markers are written by
the workflow kit and read back by the plugin. See [Loops](../README.md#loops) and
[LLM steps](../README.md#llm-steps).

## 8. The Temporal side

With the CLI (the same server, `localhost:7233`):

```sh
temporal workflow list
temporal workflow list --query "BackstageEntityRef='component:default/example-orders'"
temporal workflow show --workflow-id <a workflow ID from step 1>
```

The events of `workflow show` match the **Raw** events one to one. The lists do not
match exactly, and that is expected. The plugin asks Temporal for the executions of
the entity's task queue and workflow types, or with the entity in the
`BackstageEntityRef` search attribute, and, unless **Show all runs** is on, leaves
out runs that continued as new
(`ExecutionStatus != 'ContinuedAsNew'`): one row per workflow. The CLI lists every
run. Each batch of example workflows has five runs that continued as new
(`pollWorkflow` three, `longRefineWorkflow` two), so until you turn on **Show all
runs** the CLI lists five more executions per batch than the plugin does. The
numbers also grow with every batch you started and every ticket you ran.

## 9. Automated checks and clean-up

The repository's Playwright smoke tests walk many of these screens and save a
screenshot of each step (`yarn test:e2e`, or `yarn test:e2e:next` for the new
frontend system app; see the README's
[Development section](../README.md#development)). They need
`npx playwright install chromium`.

To clean up, stop each process with Ctrl+C. If you started them, stop the Zigflow
container (`docker rm -f zigflow`) and the RustFS compose project (`docker compose -f
examples/docker-compose.rustfs.yaml down -v`, with the `PAYLOAD_S3_*` variables
set). A development Temporal server keeps
its data in memory unless you gave it a database file, so stopping it forgets the
workflows.

## What you should be able to do afterwards

- [ ] Say how Workflow Type, Workflow Execution and Run ID differ and point at
      each on a screen.
- [ ] Find the failed step, its error and its attempts in the graph.
- [ ] Find the scheduled, started and completed events of one activity in the raw
      events.
- [ ] Send a signal, a query and an update, and say which of them are recorded in
      the history.
- [ ] Explain the difference between Cancel and Terminate.
- [ ] Move between the runs of a Continue-As-New chain and open a child workflow.
- [ ] Explain why a workflow shows **Waiting for approval**.
- [ ] Find the same workflows with the Temporal CLI.

Back to [the documentation index](README.md).
