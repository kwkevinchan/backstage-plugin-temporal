# How it works

English | [繁體中文](zh-TW/how-it-works.md)

This guide answers: how does a request travel from the browser to Temporal and
back, where are the permission checks and audit records, and how do the optional
modules fit in? It uses two requests: opening the details page of a run (a
read), and pressing Cancel on it (an operation). It then follows a longer
scenario, a Scaffolder template that starts a workflow, waits for it and
sends it an update.

The plugin has two parts: it shows Temporal workflows in Backstage, and,
unless `temporal.control.enabled` is false, it lets people operate them from
Backstage.
It has no database of its own. Every request asks Temporal, and Backstage's
permission framework decides what the user may see.

## Figure 1: one request through the layers

![Two requests, a read and an operation, go down the same layers: browser, routes, access checks, services, repositories, the shared connection and Temporal. Both pass the same access check; the operation also passes an operation permission and is audited.](images/request-path.svg)

Teal is the read path. Orange is the operation path (the routes that change
workflows, unless `temporal.control.enabled` is false). Both go down the same layers and through the same access check. After
that, a read goes to a query service; an operation passes a second, operation
permission and runs inside an audit record. Both reach Temporal through the same
connection. The layers are described in
[Architecture](architecture.md#the-layers).

### Read: open the details page

1. The page calls the backend with `TemporalClient`; Backstage's `fetchApi`
   attaches the user's token.
2. `routes/router.ts` identifies the user and takes the namespace and workflow
   ID from the URL. It makes no decisions; it hands over.
3. `TemporalAccessService.loadWorkflow()` runs the checks: the namespace is in the
   allowed list (otherwise `400`); the user has the read permission on the entity
   the page belongs to (otherwise `403`); the entity exists in the catalog and
   the user may see it, and the workflow belongs to that entity (otherwise
   `404`). A workflow opened without an entity (from the Workflows page) is
   allowed by the list permission instead; if that does not apply, the
   workflow's `entityRef` search attribute decides which entity the permission
   is checked on.
4. `WorkflowQueries` reads the workflow through `TemporalReadRepository` and turns
   the Temporal data into the plugin's own API types. Details of a workflow whose
   memo is stored in S3 are resolved by `PayloadStore`, which also checks the
   SHA-256.
5. The JSON goes back to the page. Errors from Temporal become HTTP statuses, for
   example `503` when Temporal cannot be reached.

The lists use the same layers with a different entry: the route asks the access
service for the read permission on the entity (`loadEntity`), and
`WorkflowListQueries` builds the query. The Workflows page asks for the list
permission instead, whose conditions the backend turns into a visibility query.

### Operate: press Cancel

1. The button comes from the frontend plugin. After confirmation it sends
   `POST …/cancel`.
2. `controlRoutes.ts` first calls the same `loadWorkflow()`. A user who cannot see
   a workflow cannot operate it.
3. A second check follows: the `temporal.workflow.cancel` permission on the entity.
   Being able to read is not being able to cancel. The run must also be running,
   otherwise the answer is `409`.
4. `audited()` opens an audit event, runs `WorkflowCommands.cancel()` and records
   success or failure.
5. `WorkflowCommands` sends the cancel request over the shared connection,
   as the Backstage user's identity, and the page reads the workflow again.

### What Figure 1 shows

- **No database.** The plugin is a layer in front of Temporal. Every request asks
  Temporal and uses Backstage permissions to decide what to show.
- **One access check.** The backend plugin provides `TemporalAccessService`
  (`temporalAccessServiceRef`); the routes that change workflows and the
  modules use it. There are not two copies that could disagree.
- **The operate column can be turned off.** With `temporal.control.enabled:
false` the backend has no route that changes a workflow, and the pages are
  read-only.

## Figure 2: from a template to a decision

This scenario follows a Scaffolder template that starts a workflow, waits until
the workflow asks for a decision, and then an update that gives the decision.
The workflow code is yours; the figure uses no workflow of this repository.

![Time runs downward in four phases. The user runs a template, whose step starts a workflow through the plugin as that user. A second step waits until the workflow sets a search attribute. An update is sent through the plugin and delivered to the workflow, which then completes. Every plugin call passes the permission checks.](images/request-sequence.svg)

Orange arrows are operations (the routes that change workflows), teal arrows are reads,
purple is your code (the Worker and what it sends), black is Backstage and
Temporal doing their own work, and dashed lines are replies. Time runs downward.

1. **Start.** The user submits the template. Its `temporal:workflow:start` step
   calls the plugin's backend **as that user**. The plugin checks the start
   permission on the entity, checks that the workflow type and task queue are the
   entity's own, opens an audit event, sets the `entityRef` and `initiator` search
   attributes, and starts the workflow. It answers `201` with the workflow ID.
   Temporal puts a task on the task queue and a Worker runs the workflow.
2. **Wait.** The `temporal:workflow:wait` step polls `GET …/workflows/:workflowId`
   (at once, then after `intervalSeconds`, default 5 seconds, with each pause
   doubling up to `maxIntervalSeconds`, default 30) until the Bool search attribute named in
   `untilSearchAttribute` is true. The workflow set it when it reached the point
   where it needs a decision, so the template finishes with a link to the workflow.
3. **Decision.** Someone sends an update: from the **Update…** dialog on the details
   page, or with another template whose `temporal:workflow:signal` step has
   `kind: update`. The plugin passes the access check, checks the update
   permission, checks the name against `temporal.control.allowedUpdates`, opens an
   audit event and sends the update with the user's identity. The workflow's
   validator checks it, the handler records the decision, and the result (or the
   validator's error) goes back to the user.
4. **Finish.** The workflow continues, clears the attribute and completes. The
   page reads it again through the path of Figure 1.

### What Figure 2 shows

- **The plugin appears three times:** starting the workflow, letting the template
  poll its state, and delivering the update. Every time it checks permissions
  first. The workflow itself runs in your Worker; while it waits for a decision it
  just sits there, and Temporal keeps its state.
- **Template steps run as the user who runs the template**, not as the Scaffolder's
  own identity, so permissions and audit records count against that user. That
  user's token lasts about an hour from the creation of the task, so `wait` is
  limited to 3600 seconds, and a task that started with service credentials runs as
  that service. See the
  [Scaffolder module README](../plugins/scaffolder-backend-module-temporal/README.md).
- **A decision can arrive by different routes with different checks.** Through the
  plugin's update endpoint, which is what the dialog and the template step use, the
  checks are the update permission and `allowedUpdates`; whether the user is
  _entitled_ to decide is up to the update handler in your workflow, so check it
  there (the entity's `spec.messages` can prefill the signed-in user into an
  argument with `userField`, but a request can be made without the form). If you
  need an extra rule at the plugin, register your own control action, which goes
  through the same two permission checks and audit and can add its own rules; see
  [Extension points](architecture.md#extension-points).

## Where the optional modules attach

The backend plugin itself adds a processor to the catalog, which makes the
catalog accept `TemporalWorkflow` entities and emit their relations, and
serves the operations of Figure 1's orange column unless
`temporal.control.enabled` is false.

| Module                                                          | Attaches at            | What it does                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scaffolder-backend-module-temporal`                            | in front of Routes     | The template steps `temporal:workflow:start`, `wait` and `signal` call the same HTTP routes as the user, so permissions and audit are the same.                                                                |
| `scaffolder-module-temporal`                                    | the browser            | The `TemporalWorkflowPicker` field in the Create form, fed by the plugin's routes.                                                                                                                             |
| `temporal-module-zigflow` and `temporal-backend-module-zigflow` | the browser and Routes | A **Definition** tab and a route that reads the YAML definition file of an entity.                                                                                                                             |
| Your control action                                             | the control Routes     | Registered with `temporalControlExtensionPoint`; served as `POST …/actions/:actionId`, with the same access check, its own permission and an audit record.                                                     |
| Your workflow enricher                                          | Services               | Registered with `temporalWorkflowEnricherExtensionPoint` (it only adds enrichers; custom actions use `temporalControlExtensionPoint`); adds fields to workflow summaries and details before they are returned. |

Back to [the documentation index](README.md), or on to
[Architecture](architecture.md).
