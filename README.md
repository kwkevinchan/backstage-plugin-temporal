# Backstage plugin for Temporal

> **Unofficial.** This project is a community plugin. It is not affiliated with,
> endorsed by, or supported by Temporal Technologies, Inc. or the Backstage
> project. "Temporal" is used only to describe what the plugin connects to.

**Status: pre-alpha.** Nothing is published yet and every API may change. The
first usable release is planned as `0.1.0`.

The plugin shows [Temporal](https://temporal.io) workflows next to the catalog
entities that own them in [Backstage](https://backstage.io): a list of workflow
executions per entity with the progress of each run, and a details page built
around a graph of the run's steps, with the inputs, outputs, errors and
retries of each step, and the event history. Workflows can be catalog entities of their own (the
`TemporalWorkflow` kind), and a **Workflows** page lists every workflow of a
namespace. Workflows can be started, signaled, updated, queried, canceled,
terminated and rerun from Backstage; every operation is checked with the
permission framework and recorded with the auditor.

## Packages

| Package                                                                                                    | Role                  | Description                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| [`@kwkevinchan/backstage-plugin-temporal`](plugins/temporal)                                               | frontend-plugin       | Entity tab and workflow details. Legacy entry point and `./alpha` for the new frontend system. |
| [`@kwkevinchan/backstage-plugin-temporal-react`](plugins/temporal-react)                                   | web-library           | Frontend extension points: API ref, workflow actions and sections, blueprints.                 |
| [`@kwkevinchan/backstage-plugin-temporal-backend`](plugins/temporal-backend)                               | backend-plugin        | REST API under `/api/temporal`: read and control workflows, permission checks.                 |
| [`@kwkevinchan/backstage-plugin-temporal-common`](plugins/temporal-common)                                 | common-library        | Shared types, permissions and annotation constants.                                            |
| [`@kwkevinchan/backstage-plugin-temporal-node`](plugins/temporal-node)                                     | node-library          | Shared Temporal client service and backend extension point.                                    |
| [`@kwkevinchan/backstage-plugin-catalog-backend-module-temporal`](plugins/catalog-backend-module-temporal) | backend-plugin-module | Catalog module with the `TemporalWorkflow` kind.                                               |
| [`@kwkevinchan/temporal-payload-s3`](plugins/temporal-payload-s3)                                          | node-library          | Payload codec for workers: large payloads in S3, a claim check in the history.                 |
| [`@kwkevinchan/temporal-loop`](plugins/temporal-loop)                                                      | node-library          | For workflow code: loop markers, a loop state query and continue-as-new helpers.               |

Plugins that add buttons or cards to the workflow page depend on
`@kwkevinchan/backstage-plugin-temporal-react` only.

Development-only packages (never published): `packages/app` (legacy frontend
system), `packages/app-next` (new frontend system), `packages/backend` and
`packages/example-worker`.

## Installation

The packages are not published yet; these steps describe the planned setup.

Backend (`packages/backend/src/index.ts`):

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
// Optional: the TemporalWorkflow kind.
backend.add(
  import('@kwkevinchan/backstage-plugin-catalog-backend-module-temporal'),
);
```

The backend plugin needs the catalog and the permission framework. It only
uses `@temporalio/client` (no worker code runs inside Backstage).

Frontend, new frontend system: add the plugin to your app features (or let
feature discovery find it):

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

Frontend, legacy system (`EntityPage.tsx`):

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

## Workflow details

The details page of a run shows, from top to bottom:

- a summary line: status, where the run is now (what it waits for, or the
  step it failed at), workflow type, duration and start time, the link to
  the Temporal UI and a refresh button. Running workflows reload every five
  seconds; the **Auto refresh** switch turns this off.
- the step graph: one box per step and arrows between them. Colors follow
  the status, running steps pulse, waiting steps are dashed, retried
  activities show their attempt (`×3`), and a child workflow links to its own
  details. The graph can be zoomed, panned and fitted to the view. Selecting
  a step opens a panel with its input, output, error, attempts and events.
- tabs: **Steps** (a table of the steps), **Events** (grouped by step, or the
  raw history), **Details** (the summary table, failure, pending activities,
  search attributes and memo), and one tab per workflow section.

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

Workflow lists show a progress column (done steps and the current step or
failure). It is loaded for the rows on screen only, with at most four
requests at a time; the backend reads at most 1000 events per run for it and
keeps the progress of closed runs in memory.

## Loops

AI workflows often loop: generate, check, and revise when the check fails,
for dozens of rounds and across continue-as-new runs. Drawn step by step,
such a graph becomes unreadable. When the activities and child workflows of
each round carry a loop marker (`loop/<loop>/<round>/<step>` in the activity
ID; see [`@kwkevinchan/temporal-loop`](plugins/temporal-loop) for the
format and a TypeScript helper):

- the graph shows each loop as one box, `draft-review · Round 4 of 5 · Done`,
  with the steps before it and after it. Pressing the box, or **Expand**
  above the graph, shows the steps of one round; the arrows above the graph
  step through the rounds. Timers and signals that start during a round
  belong to it.
- the **Loops** tab has one table per loop: each round with its steps,
  status, duration, decision and score, newest first. Pressing a round shows
  it in the graph. Rounds of a workflow that continued as new are counted
  across its runs (`GET .../loops` reads up to 20 runs); a round of another
  run links to that run, opened at the round.
- the limit, the state (`running`, `done`, `exhausted`, `failed`) and the
  decisions and scores come from the `temporal.loops` memo the helper
  upserts after each round, and for a running workflow from its
  `__loop_state` query when a worker answers within three seconds.

Workflows without markers look as before. The loop data needs the read
permission, like the graph; inputs and results are not part of it.

## Configuration

```yaml
temporal:
  connection:
    address: localhost:7233
    # Namespaces the plugin may read; requests for others are rejected.
    # The UI uses one namespace per entity; the API takes the namespace as a
    # parameter.
    namespaces: [default]
    defaultNamespace: default
    # `none` (default) or `bearer`, see Authentication below.
    auth:
      type: none
  # Optional: adds "Open in Temporal UI" links.
  webUi:
    baseUrl: http://localhost:8080
  # Optional: names of custom search attributes registered in Temporal.
  searchAttributes:
    # Keyword attribute with the entity reference, e.g. component:default/orders.
    entityRef: BackstageEntityRef
    initiator: BackstageInitiator
```

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
role on the `default` namespace. The plugin only reads workflows, so a token
with the read role on the namespaces in `connection.namespaces` is enough.
See the Temporal documentation on server security for the details. The token
is read at startup; restart the backend after it is replaced.

## Large payloads in S3

Workers can store large payloads in any S3-compatible object store with the
[`@kwkevinchan/temporal-payload-s3`](plugins/temporal-payload-s3) codec
(claim check pattern): payloads above a threshold (default 128 KiB) are
uploaded, and the history keeps a claim check with the bucket, key, size,
SHA-256, original encoding and media type. See its README for the worker
setup, the key layout, bucket permissions and lifecycle cleanup.

To show the stored data in Backstage, give the backend read access to the
same bucket:

```yaml
temporal:
  payloads:
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
  WebP up to 8 MiB) as a thumbnail;
- without `temporal.payloads.s3`: "Stored externally (S3 is not configured
  in Backstage)" with the bucket, key and SHA-256, and no error;
- data that cannot be read or does not match its SHA-256: the error.

Downloads go through the backend,
`GET /api/temporal/namespaces/:namespace/workflows/:workflowId[/runs/:runId]/payloads/download?key=<key>`,
with the same checks as the history (`temporal.workflow.history.read`, or
the list permissions without `entityRef`). The key must belong to a claim
check in the history of that run, and the claim check must name the
configured bucket, so a caller cannot read other objects. The backend
streams the object and checks its SHA-256 on the way; on a mismatch it
aborts the response. The S3 credentials stay in the backend: the plugin does
not use presigned URLs, because a presigned URL works for anyone who has it
until it expires, outside of the Backstage permission checks. The cost is
that downloads pass through the backend, and the browser holds a download in
memory before it saves it, so very large objects are better fetched from S3
directly.

The backend keeps up to 32 MiB of downloaded JSON in memory, by SHA-256, so
reloading a page does not download the same data again.

## Workflow entities

The catalog module adds the `TemporalWorkflow` kind for one workflow type:

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

The runs of the entity are the executions with that workflow type (and task
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
then lists the workflow entities, and its runs are its own (from the
annotations, if any) together with the runs of each workflow entity; runs of
a workflow entity link to it. Workflow entities in another Temporal
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

| Permission                       | Resource type    | Used for                                                   |
| -------------------------------- | ---------------- | ---------------------------------------------------------- |
| `temporal.workflow.read`         | `catalog-entity` | Workflow list, details, step graph and progress            |
| `temporal.workflow.history.read` | `catalog-entity` | Event history, inputs and results                          |
| `temporal.workflow.list`         | none (basic)     | Workflows page; details and step graph without an entity   |
| `temporal.workflow.history.list` | none (basic)     | Event history, inputs and results without an entity        |
| `temporal.workflow.start`        | `catalog-entity` | Start a workflow of the entity, or from the Workflows page |
| `temporal.workflow.signal`       | `catalog-entity` | Send a signal                                              |
| `temporal.workflow.update`       | `catalog-entity` | Send an update (also used by the example custom action)    |
| `temporal.workflow.cancel`       | `catalog-entity` | Ask a running workflow to cancel                           |
| `temporal.workflow.terminate`    | `catalog-entity` | Terminate a running workflow, with a reason                |
| `temporal.workflow.rerun`        | `catalog-entity` | Start a run again with the same input                      |

The plugin registers the permissions and checks them on every request. The
entity permissions use the entity as the resource. `temporal.workflow.list`
is a basic permission: it allows the Workflows page, which lists every
workflow of the allowed namespaces, and opening the details and the step
graph of any of them without an entity. Their event history, inputs and
results also need `temporal.workflow.history.list`, another basic
permission. Give them only to users who may read every workflow. When a
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

The details page has an action bar with the operations that fit the run:

- running: **Signal…**, **Update…**, **Query…**, **Cancel** and
  **Terminate**;
- closed: **Rerun** and **Query…**.

Cancel and Terminate ask for confirmation; Terminate needs a reason, which is
kept in the history. Rerun starts a new workflow with the input, workflow
type, task queue, memo, timeouts, retry policy and search attributes of the
run's start event, under a new workflow ID, and opens it. The Signal, Update
and Query dialogs offer the names the workflow defines (read with the
`__temporal_workflow_metadata` query of the Temporal SDKs; any name can be
typed), take the arguments as JSON and show the result or the error, for
example the message of an update validator.

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
also needs `temporal.workflow.list`. Queries only read the workflow and need
the read permission. Denied requests answer 403. Each operation is recorded
with the auditor service (`workflow-start`, `workflow-signal`,
`workflow-update`, `workflow-query`, `workflow-cancel`, `workflow-terminate`,
`workflow-rerun`, `workflow-action`), with the user, the workflow and the
operation. The Temporal history shows the user as the identity
(`backstage:user:default/jane`).

```yaml
temporal:
  control:
    # Default true. When false the operations answer 404 and are hidden;
    # queries keep working.
    enabled: true
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

New frontend system, with `@kwkevinchan/backstage-plugin-temporal-react/alpha`:

```ts
TemporalWorkflowActionBlueprint.make({
  name: 'approve',
  params: {
    loader: () => import('./ApproveButton').then(m => m.ApproveButton),
    filter: workflow => workflow.status === 'Running',
  },
});
```

`TemporalWorkflowSectionBlueprint` adds a tab in the same way. Both attach to
the shared mount point `api:temporal/workflow-extensions`
(`temporalWorkflowExtensionsApiRef`), so they show on the details pages of
the entity tab and of the Workflows page. In the legacy system, pass
`workflowActions` and `workflowSections` to `EntityTemporalContent` and to
`TemporalPage`. Components get the workflow as props or through
`useTemporalWorkflow()`.

Backend modules can add data to workflow summaries with
`temporalExtensionPoint.addWorkflowEnricher()` from
`@kwkevinchan/backstage-plugin-temporal-node`, and custom workflow actions
with `addControlAction()`. An action is served as
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

The frontend shows it as a button that runs the action and shows the result.
New frontend system:

```ts
TemporalWorkflowActionBlueprint.make({
  name: 'escalate',
  params: {
    controlAction: {
      actionId: 'escalate',
      label: 'Escalate',
      confirm: 'Raise the priority to high?',
      // Optional: disables the button without the permission.
      permission: temporalWorkflowUpdatePermission,
    },
    filter: workflow => workflow.status === 'Running',
  },
});
```

Legacy system: add
`createTemporalControlActionDef({ actionId: 'escalate', label: 'Escalate' })`
to `workflowActions`. Custom components can call the actions and the
operations with `TemporalApi` (`runWorkflowAction`, `signalWorkflow`, …).
The development apps have an example (`packages/backend/src/escalateAction.ts`).

## Compatibility

The main line targets Backstage **1.56.x** (see `backstage.json`), which is the
minimum supported version. Both frontend systems are supported: the legacy
system (`EntityPage.tsx`) and the new frontend system (`./alpha`).

The screens use the Backstage design system `@backstage/ui`; the app must
load its styles (`import '@backstage/ui/css/styles.css'`, as apps created for
1.56 do). Light and dark themes follow the app theme. The step graph uses
[React Flow](https://reactflow.dev) (`@xyflow/react`) with the
[dagre](https://github.com/dagrejs/dagre) layout, both MIT licensed.

## Development

Requirements: Node.js 22 or 24, and Yarn 4 through Corepack.

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
`PAYLOAD_S3_*` variables. The worker then also runs `reportWorkflow`, with
about 1 MB of JSON, 180 KiB of JSON and a PNG as outputs:

```sh
export PAYLOAD_S3_ENDPOINT=http://localhost:9100 PAYLOAD_S3_BUCKET=temporal-payloads
export PAYLOAD_S3_ACCESS_KEY=dev-access PAYLOAD_S3_SECRET_KEY=dev-secret-key
docker compose -f examples/docker-compose.rustfs.yaml up -d
yarn workspace backend start --config ../../app-config.yaml --config ../../app-config.s3.yaml
yarn workspace example-worker start
SMOKE_S3=1 yarn test:e2e   # adds the S3 payload smoke test
```

The example worker also runs two loops: `draftReviewWorkflow` (draft,
review, revise until the score is high enough; done in round 4 of 5) and
`longRefineWorkflow` (25 rounds that continue as new every 10 rounds).

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

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright The backstage-plugin-temporal Authors.

Licensed under the [Apache License, Version 2.0](LICENSE).
