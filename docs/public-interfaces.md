# Public interfaces

English | [繁體中文](zh-TW/public-interfaces.md)

This guide answers: what can code outside this repository rely on, and where
does each part plug in? It lists every interface that another installation
depends on, so that changing it breaks someone: the npm entry points, the
backend and frontend extension points, the HTTP API, the permissions, the
configuration keys, the catalog annotations and kind, what the plugin writes
into Temporal, and the Scaffolder and Zigflow modules. Each kind of interface
has a short example you can copy.

Read it when you install the plugin in your own Backstage, write a module
that extends it, or call it from other code. The [README](../README.md) is
the reference for installation and the meaning of each setting; this guide
links to it instead of repeating it. For the layers behind the interfaces see
[Architecture](architecture.md) and [How it works](how-it-works.md).

- [Stability](#stability)
- [Where the interfaces are](#where-the-interfaces-are)
- [npm entry points](#npm-entry-points)
- [Backend extension](#backend-extension)
- [Frontend extension](#frontend-extension)
- [HTTP API](#http-api)
- [Permissions](#permissions)
- [Configuration keys](#configuration-keys)
- [Catalog: annotations and the `TemporalWorkflow` kind](#catalog-annotations-and-the-temporalworkflow-kind)
- [What the plugin writes](#what-the-plugin-writes)
- [Scaffolder](#scaffolder)
- [Zigflow](#zigflow)
- [Experimental: loops and model calls](#experimental-loops-and-model-calls)
- [Examples](#examples)
- [Not public](#not-public)
- [Keeping this guide true](#keeping-this-guide-true)

## Stability

Every exported name carries a release tag in its doc comment, and the
[API reports](#keeping-this-guide-true) show it on each line:

| Tag          | Meaning                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@public`    | Part of the supported API. Until `1.0.0` a minor version may still change it, and the changelog says so ([README](../README.md)).                                                                                      |
| `@alpha`     | Usable, with no compatibility promise between versions. The `./alpha` entry points hold only these; so does `./ui`, and `./common` has 32 of them (the experimental names).                                            |
| Experimental | The loop views (`temporal.experimental.aiWorkflows`) and the model call types. They will change substantially before the first release; see [Experimental](#experimental-loops-and-model-calls). Do not build on them. |

The HTTP API, the permissions, the configuration keys, the annotations, the
kind and the search attributes have no tag of their own: they follow the
package that serves or reads them (`temporal-backend`, `@public`), except the
experimental routes and key.

## Where the interfaces are

![Where the interfaces of the plugin are. In the Backstage app, your app and plugins use the npm entry points of temporal-frontend (1) and its extensions: blueprints, props and temporalApiRef (2). The browser, other backend plugins and the Scaffolder module call the HTTP API under /api/temporal (3). In the Backstage backend, your modules use the extension points and service refs (4), your permission policy the permissions and conditions (5), the catalog gets the TemporalWorkflow kind, and the plugin reads that kind and the annotations of entities (6), and app-config holds the temporal keys (7). The backend reaches Temporal with @temporalio/client and writes search attributes, the identity and audit events (8). Workers run your workflow code.](images/interfaces-overview.svg)

Each number is one kind of interface; the sections below follow them.
Teal is what the frontend uses, orange what backend code uses, purple
what crosses a process boundary (HTTP, Temporal).

1. **npm entry points** of the six packages ([npm entry points](#npm-entry-points)).
2. **Frontend extension**: blueprints, legacy props and `temporalApiRef`
   ([Frontend extension](#frontend-extension)).
3. **HTTP API** under `/api/temporal` ([HTTP API](#http-api)).
4. **Backend extension**: service refs and extension points
   ([Backend extension](#backend-extension)).
5. **Permissions** and conditions for your policy ([Permissions](#permissions)).
6. **Catalog**: the `TemporalWorkflow` kind and the annotations
   ([Catalog](#catalog-annotations-and-the-temporalworkflow-kind)).
7. **Configuration** under `temporal` ([Configuration keys](#configuration-keys)).
8. **What the plugin writes** into Temporal and the audit log
   ([What the plugin writes](#what-the-plugin-writes)).

## npm entry points

![The six published packages and their entry points, with the number of names, the release tag and the API report file of each. temporal-backend: . 3 public (report.api.md), ./alpha 26 alpha (report-alpha.api.md), ./node 3 public (report-node.api.md), ./common 128, of which 96 public and 32 experimental alpha (report-common.api.md). temporal-frontend: . 25 public, ./alpha 6 alpha, ./common the same 128, ./ui 24 alpha, for companion packages only (report-ui.api.md). temporal-backend-module-zigflow: . 1 public. temporal-module-zigflow: . 1 public, ./alpha 2 alpha. scaffolder-backend-module-temporal: . 1 public. scaffolder-module-temporal: . 2 public, ./alpha 2 alpha.](images/entry-points.svg)

All package names start with `@kwkevinchan/backstage-plugin-`. The full,
generated list of each entry point is its API report (the last column);
the tables below say what each name is for.

| Package                              | Entry      | Names | Tag                       | For                                                   | API report                                                                         |
| ------------------------------------ | ---------- | ----: | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `temporal-backend`                   | `.`        |     3 | `@public`                 | Installing the backend                                | [`report.api.md`](../plugins/temporal-backend/report.api.md)                       |
|                                      | `./node`   |     3 | `@public`                 | Other backend code that needs Temporal                | [`report-node.api.md`](../plugins/temporal-backend/report-node.api.md)             |
|                                      | `./alpha`  |    26 | `@alpha`                  | Backend modules and permission policies               | [`report-alpha.api.md`](../plugins/temporal-backend/report-alpha.api.md)           |
|                                      | `./common` |   128 | `@public` 96, `@alpha` 32 | Types, paths, permissions, annotations (backend code) | [`report-common.api.md`](../plugins/temporal-backend/report-common.api.md)         |
| `temporal-frontend`                  | `.`        |    25 | `@public`                 | Legacy frontend system, and types for extensions      | [`report.api.md`](../plugins/temporal-frontend/report.api.md)                      |
|                                      | `./alpha`  |     6 | `@alpha`                  | New frontend system: the plugin and the blueprints    | [`report-alpha.api.md`](../plugins/temporal-frontend/report-alpha.api.md)          |
|                                      | `./common` |   128 | `@public` 96, `@alpha` 32 | The same definitions, for frontend code               | [`report-common.api.md`](../plugins/temporal-frontend/report-common.api.md)        |
|                                      | `./ui`     |    24 | `@alpha`                  | Companion packages of this repository only            | [`report-ui.api.md`](../plugins/temporal-frontend/report-ui.api.md)                |
| `temporal-backend-module-zigflow`    | `.`        |     1 | `@public`                 | Installing the module                                 | [`report.api.md`](../plugins/temporal-backend-module-zigflow/report.api.md)        |
| `temporal-module-zigflow`            | `.`        |     1 | `@public`                 | Legacy frontend system                                | [`report.api.md`](../plugins/temporal-module-zigflow/report.api.md)                |
|                                      | `./alpha`  |     2 | `@alpha`                  | New frontend system                                   | [`report-alpha.api.md`](../plugins/temporal-module-zigflow/report-alpha.api.md)    |
| `scaffolder-backend-module-temporal` | `.`        |     1 | `@public`                 | Installing the module                                 | [`report.api.md`](../plugins/scaffolder-backend-module-temporal/report.api.md)     |
| `scaffolder-module-temporal`         | `.`        |     2 | `@public`                 | Legacy frontend system                                | [`report.api.md`](../plugins/scaffolder-module-temporal/report.api.md)             |
|                                      | `./alpha`  |     2 | `@alpha`                  | New frontend system                                   | [`report-alpha.api.md`](../plugins/scaffolder-module-temporal/report-alpha.api.md) |

`./common` of the frontend is a generated copy of the backend's (a frontend
plugin may not import a backend plugin); both reports are identical. Import
it from the package of your side. The entry points for modules (`./node`,
`./alpha`, `./common` of the backend) do not load the plugin itself.

### `temporal-backend`

| Name                                                                                                                                                                                      | Entry     | What it is                                                                                               | Use it when                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `default`                                                                                                                                                                                 | `.`       | Feature loader: `temporalPlugin`, `temporalAccessServiceFactory` and `catalogModuleTemporalWorkflowKind` | You install the backend: `backend.add(import('…-temporal-backend'))`          |
| `temporalPlugin`                                                                                                                                                                          | `.`       | The backend plugin (`pluginId: 'temporal'`)                                                              | You add the features one by one, for example without the catalog module       |
| `catalogModuleTemporalWorkflowKind`                                                                                                                                                       | `.`       | Catalog module (`catalog` / `temporal-workflow-kind`) with the processor of the kind                     | The catalog runs in another backend than the plugin                           |
| `temporalServiceRef`                                                                                                                                                                      | `./node`  | Root service ref of the shared Temporal connection (`temporal.client`)                                   | Other backend code calls Temporal, or you replace the connection              |
| `TemporalService`                                                                                                                                                                         | `./node`  | Its interface: `getClient()`, `getConnection()`, the namespaces, search attribute names, Web UI links    | You use or implement the service                                              |
| `TemporalSearchAttributeNames`                                                                                                                                                            | `./node`  | `{ entityRef?, initiator? }`, the configured attribute names                                             | You read `getSearchAttributeNames()`                                          |
| `temporalAccessServiceRef`                                                                                                                                                                | `./alpha` | Plugin-scoped service ref of the access checks (`temporal.access`)                                       | Your module serves routes and needs the same checks, or decides access itself |
| `temporalAccessServiceFactory`                                                                                                                                                            | `./alpha` | The default factory of that ref                                                                          | You add `temporalPlugin` alone                                                |
| `TemporalAccessService` and its types `TemporalAccessibleWorkflow`, `TemporalEntityContext`, `TemporalWorkflowAccessLevel`                                                                | `./alpha` | The access interface ([below](#temporalaccessserviceref))                                                | As above                                                                      |
| `temporalControlExtensionPoint`, `TemporalControlExtensionPoint`, `TemporalControlAction`, `TemporalControlActionContext`                                                                 | `./alpha` | Custom workflow actions                                                                                  | You add an operation of your own                                              |
| `temporalWorkflowEnricherExtensionPoint`, `TemporalWorkflowEnricherExtensionPoint`, `TemporalWorkflowEnricher`, `TemporalWorkflowEnricherContext`                                         | `./alpha` | Enrichers of workflow summaries                                                                          | You add data to the lists and the details                                     |
| `temporalLlmAdapterExtensionPoint`, `TemporalLlmAdapterExtensionPoint`, `TemporalLlmAdapter`, `TemporalLlmStep`, `TemporalLlmStepPayloads`, `TemporalLlmModelCall`, `TemporalLlmToolStep` | `./alpha` | LLM adapters: model calls and tool calls of a framework ([below](#llm-adapters))                         | The plugin should show the model calls of a framework it does not know        |
| `temporalWorkflowPermissionResourceRef`, `TemporalWorkflowQuery`                                                                                                                          | `./alpha` | The `temporal-workflow` permission resource and what a rule turns into for lists                         | You add permission rules                                                      |
| `temporalWorkflowPermissionRules`                                                                                                                                                         | `./alpha` | The four rules of that resource                                                                          | You build conditions with other helpers                                       |
| `temporalWorkflowConditions`, `createTemporalWorkflowConditionalDecision`                                                                                                                 | `./alpha` | Conditions and conditional decisions for the list permissions                                            | Your permission policy                                                        |

### `./common` (both core packages)

The 128 names in groups. Every name is in the
[report](../plugins/temporal-backend/report-common.api.md).

| Group (source file)                               | Names                                                                                                                                                                                                                                                                                                                                                                                                                                            | Used by                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Workflows (`types.ts`, 15)                        | `WorkflowRef`, `WorkflowSummary`, `WorkflowDetail`, `WorkflowStatus`, `WORKFLOW_STATUSES`, `WorkflowFailure`, `PendingActivity`, `WorkflowListResponse`, `WorkflowStatsResponse`, `WorkflowHistoryEvent`, `WorkflowHistoryResponse`, `WorkflowStepsResponse`, `ActivityStep`, `DecodedPayload`, `ExternalPayload`                                                                                                                                | Clients of the HTTP API, enrichers, actions                                                    |
| Graph and progress (`graph.ts`, 10)               | `WorkflowGraphResponse`, `WorkflowGraphNode`, `WorkflowGraphEdge`, `WorkflowNodeKind`, `WorkflowNodeStatus`, `WorkflowNodeAttempt`, `WorkflowNodeEvent`, `WorkflowDeadline`, `WorkflowRunChain`, `WorkflowProgressResponse`                                                                                                                                                                                                                      | Clients of `…/graph` and `…/progress`                                                          |
| Operations (`controls.ts`, 10)                    | `WorkflowControlOperation`, `WorkflowMessageRequest`, `WorkflowMessageResponse`, `WorkflowStartRequest`, `WorkflowStartResponse`, `WorkflowHandler`, `WorkflowHandlersResponse`, `buildWorkflowOperationPath`, `buildWorkflowActionPath`, `buildWorkflowHandlersPath`                                                                                                                                                                            | Clients that operate workflows                                                                 |
| Schedules (`schedules.ts`, 8)                     | `TemporalSchedule`, `TemporalScheduleAction`, `TemporalScheduleListResponse`, `TemporalScheduleNoteRequest`, `TemporalScheduleOperation`, `SCHEDULES_PATH`, `buildEntitySchedulesPath`, `buildScheduleOperationPath`                                                                                                                                                                                                                             | Clients of the schedule routes                                                                 |
| Paths (`paths.ts`, 4)                             | `buildWorkflowPath`, `buildEntityWorkflowsPath`, `buildEntityWorkflowStatsPath`, `WORKFLOWS_PATH`                                                                                                                                                                                                                                                                                                                                                | Building HTTP API paths                                                                        |
| Permissions (`permissions.ts`, 16)                | The 11 permissions (`temporalWorkflowReadPermission` … `temporalWorkflowRerunPermission`, see [Permissions](#permissions)), `temporalPermissions`, `temporalControlPermissions`, `RESOURCE_TYPE_TEMPORAL_WORKFLOW`, `parseTemporalWorkflowResourceRef`, `stringifyTemporalWorkflowResourceRef`                                                                                                                                                   | Permission policies, actions, buttons                                                          |
| Annotations (`annotations.ts`, 13)                | `TEMPORAL_NAMESPACE_ANNOTATION`, `TEMPORAL_TASK_QUEUE_ANNOTATION`, `TEMPORAL_WORKFLOW_TYPE_ANNOTATION`, `TemporalAnnotations`, `parseTemporalAnnotations`, `InvalidTemporalAnnotationError`, `isTemporalAvailable`, `getDependsOnTemporalWorkflowRefs`, `isValidNamespaceName`, `isValidTaskQueueName`, `isValidWorkflowTypeName`, `isValidWorkflowIdPrefix`, `NAME_PATTERN_SOURCES`                                                             | Entity pages, catalog processors, validation                                                   |
| `TemporalWorkflow` kind (`workflowEntity.ts`, 10) | `TEMPORAL_WORKFLOW_API_VERSION`, `TEMPORAL_WORKFLOW_KIND`, `TemporalWorkflowEntityV1alpha1`, `temporalWorkflowEntityV1alpha1Schema`, `isTemporalWorkflowEntity`, `isTemporalWorkflowEntityRef`, `parseTemporalWorkflowSpec`, `InvalidTemporalWorkflowSpecError`, `getTemporalWorkflowSource`, `getTemporalWorkflowExampleArgs`                                                                                                                   | Code that reads workflow entities                                                              |
| Messages (`messages.ts`, 6)                       | `TemporalWorkflowMessageSpec`, `TemporalWorkflowMessagesSpec`, `temporalWorkflowMessageSchema`, `getTemporalWorkflowMessages`, `mergeWorkflowHandlers`, `exampleArgs`                                                                                                                                                                                                                                                                            | `spec.messages` of the kind                                                                    |
| Definition (`definition.ts`, 4)                   | `TEMPORAL_DEFINITION_FORMATS`, `TemporalDefinitionFormat`, `TemporalWorkflowDefinitionSpec`, `getTemporalWorkflowDefinitionSpec`                                                                                                                                                                                                                                                                                                                 | `spec.definition` of the kind                                                                  |
| Experimental loops (`loops.ts`, 10)               | `LOOP_MARKER_MEMO_KEY`, `LOOP_STATE_MEMO_KEY`, `LOOP_STATE_QUERY`, `WorkflowLoopGroup`, `WorkflowLoopMarker`, `WorkflowLoopRound`, `WorkflowLoopRun`, `WorkflowLoopStatus`, `WorkflowLoopStep`, `WorkflowLoopsResponse`                                                                                                                                                                                                                          | [Experimental](#experimental-loops-and-model-calls): do not use                                |
| Experimental LLM (`llm.ts`, 20)                   | `LLM_MARKER_PREFIX`, `LLM_RECORD_KEY`, `LLM_RECORD_VERSION`, `LLM_SEMCONV_VERSION`, `LLM_TOOL_RESULT_KEY`, `TOOL_MARKER_PREFIX`, `addLlmUsage`, `buildLlmCallPath`, `parseLlmMarker`, `WorkflowLlmCallResponse`, `WorkflowLlmMarker`, `WorkflowLlmMessage`, `WorkflowLlmPart`, `WorkflowLlmRecord`, `WorkflowLlmRecordState`, `WorkflowLlmSummary`, `WorkflowLlmToolCallRef`, `WorkflowLlmToolExecution`, `WorkflowLlmUsage`, `WorkflowToolLink` | [Experimental](#experimental-loops-and-model-calls): do not use                                |
| Experimental event groups (`eventGroups.ts`, 2)   | `WorkflowEventGroup`, `WorkflowEventGroupKind`                                                                                                                                                                                                                                                                                                                                                                                                   | [Experimental](#experimental-loops-and-model-calls): Event Groups are experimental in Temporal |

### `temporal-frontend`

| Name                                                                                                                                                                              | Entry     | What it is                                                                                 | Use it when                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `default`                                                                                                                                                                         | `./alpha` | The plugin for the new frontend system, with 9 extensions ([IDs](#extension-ids))          | You install it in a new-system app                          |
| `TemporalWorkflowActionBlueprint`, `TemporalWorkflowSectionBlueprint`, `TemporalWorkflowListActionBlueprint`, `TemporalScheduleActionBlueprint`, `TemporalControlActionBlueprint` | `./alpha` | The five blueprints ([below](#blueprints-and-props))                                       | You add a button, a tab or a control                        |
| `temporalPlugin`                                                                                                                                                                  | `.`       | The plugin for the legacy system                                                           | `createApp({ plugins: [...] })` of a legacy app             |
| `EntityTemporalContent`, `EntityTemporalContentProps`                                                                                                                             | `.`       | The entity tab, and its props                                                              | Legacy `EntityPage.tsx`                                     |
| `TemporalPage`, `TemporalPageProps`                                                                                                                                               | `.`       | The Workflows page, and its props                                                          | Legacy `App.tsx`                                            |
| `EntityTemporalWorkflowSummaryCard`, `EntityTemporalRelatedWorkflowsCard`                                                                                                         | `.`       | Overview cards of `TemporalWorkflow` entities and of entities that depend on them          | Legacy entity pages                                         |
| `isTemporalAvailable`, `isTemporalWorkflowEntity`, `getDependsOnTemporalWorkflowRefs`                                                                                             | `.`       | Conditions for `EntitySwitch` and `if` (also in `./common`)                                | Legacy entity pages                                         |
| `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`, `TemporalWorkflowListActionDef`, `TemporalScheduleActionDef`                                                           | `.`       | What the legacy props take                                                                 | Legacy props                                                |
| `TemporalWorkflowExtensionProps`, `TemporalWorkflowListActionProps`, `TemporalScheduleActionProps`                                                                                | `.`       | Props your components receive, in both systems                                             | Writing a button, tab or control                            |
| `useTemporalWorkflow`, `TemporalWorkflowProvider`, `TemporalWorkflowProviderProps`                                                                                                | `.`       | The workflow of the details page, from inside it; the provider wraps a component in a test | A component deep inside your tab, a test of it              |
| `createTemporalControlActionDef`, `TemporalControlActionButtonOptions`                                                                                                            | `.`       | A legacy action whose button runs a custom backend action                                  | Legacy `workflowActions`                                    |
| `temporalApiRef`, `TemporalApi`, `TemporalClient`                                                                                                                                 | `.`       | The client of the backend: ref, interface and default implementation                       | Another plugin calls the backend, or you replace the client |

`./ui` (graph canvas, status helpers, panels, class names) exists for
`temporal-module-zigflow`, which is released with the same version. Its
names are `@alpha`, with no compatibility promise: other packages should
not use it.

### Modules

| Package                              | Name                                                                      | Entry     | What it is                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `temporal-backend-module-zigflow`    | `default`                                                                 | `.`       | Backend module `temporal` / `zigflow`: the definition route                                      |
| `temporal-module-zigflow`            | `EntityTemporalDefinitionContent`                                         | `.`       | Legacy Definition tab                                                                            |
|                                      | `default`, `temporalDefinitionContent`                                    | `./alpha` | Frontend module of `temporal` with `entity-content:temporal/definition`                          |
| `scaffolder-backend-module-temporal` | `default`                                                                 | `.`       | Backend module `scaffolder` / `temporal`: the three template actions                             |
| `scaffolder-module-temporal`         | `TemporalWorkflowPickerFieldExtension`, `TemporalWorkflowPickerUiOptions` | `.`       | Legacy form field and its `ui:options`                                                           |
|                                      | `default`, `temporalWorkflowPickerFormField`                              | `./alpha` | Frontend module of `scaffolder` with `scaffolder-form-field:scaffolder/temporal-workflow-picker` |

## Backend extension

![Inside temporal-backend a request goes down four layers: routes (router.ts for reads and Query; controlRoutes.ts for the operations, mounted only when temporal.control.enabled is true), access (TemporalAccessService, the ref temporalAccessServiceRef, with the permission framework and the catalog), services (WorkflowQueries and the other query classes, WorkflowCommands) and TemporalService (temporalServiceRef, root scope) to Temporal. On the left, the modules of the plugin: temporalControlExtensionPoint adds actions to the operation routes, temporalWorkflowEnricherExtensionPoint adds enrichers to the queries, your own routes use temporalAccessServiceRef, and the Zigflow module adds a route under /api/temporal and checks the read permission itself. On the right, other backend code: the Scaffolder module calls the HTTP API as the user, your other plugin depends on temporalServiceRef, and your own factories for temporalAccessServiceRef or temporalServiceRef replace the default ones.](images/backend-interfaces.svg)

Five interfaces, at four layers. The plugin creates the rest of the
classes itself; they are not exported (see [Not public](#not-public)). The
diagram does not show the LLM adapters yet; they plug in next to the
enrichers.

### `temporalServiceRef`

`@kwkevinchan/backstage-plugin-temporal-backend/node`, `@public`. A
**root**-scoped service: one Temporal connection for the whole backend, read
from `temporal.connection`. Its default factory comes with the ref, so any
plugin or module can depend on it without installing anything else.

| Member                                             | Returns                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `getClient({ namespace? })`                        | A `@temporalio/client` `Client`; rejects a namespace that is not allowed   |
| `getConnection()`                                  | The shared `Connection` (opened on first use, closed on shutdown)          |
| `getDefaultNamespace()`                            | `temporal.connection.defaultNamespace`                                     |
| `getAllowedNamespaces()`, `isNamespaceAllowed(ns)` | `temporal.connection.namespaces` (always with the default)                 |
| `getSearchAttributeNames()`                        | `TemporalSearchAttributeNames` from `temporal.searchAttributes`            |
| `getWebUiUrl(ref)`                                 | Link to the Temporal Web UI, or undefined without `temporal.webUi.baseUrl` |

The plugin itself uses this service for every call to Temporal, reads and
operations alike. Adding your own factory for the ref replaces the
connection everywhere ([example](#own-temporalserviceref)), for example for
client certificates (mTLS), which the built-in connection does not support.

### `temporalAccessServiceRef`

`./alpha`, `@alpha`. A **plugin**-scoped service of the `temporal` plugin:
the checks every route of the plugin runs. Modules of the plugin (that is,
`createBackendModule({ pluginId: 'temporal' })`) use it in their own routes
so that "who may see this workflow" has one definition.

| Method                                                                           | Does                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadWorkflow(ref, { entityRef?, level, credentials })`                          | Reads a workflow with every check: the namespace, then, with `entityRef`, the `read` or `history` permission on that entity; without it, first the list permissions on the workflow itself, else the permission on the entity in its entity search attribute ([order](#which-entity-a-workflow-is-checked-on)) |
| `authorizeOn(permission, entityRef, credentials)`                                | Checks a `catalog-entity` permission on an entity; without one, requires an unconditional ALLOW                                                                                                                                                                                                                |
| `loadEntity(entityRef, permission, credentials)`                                 | Checks the permission, then reads the entity and the `TemporalWorkflow` entities it depends on                                                                                                                                                                                                                 |
| `canListAll`, `authorizeWorkflowList`, `canReadPayloads`, `linkWorkflowEntities` | The list permission, its visibility query, the history permission, links to workflow entities                                                                                                                                                                                                                  |

The package's default export installs the default factory
(`temporalAccessServiceFactory`). To decide access in another way, add a
factory of your own for the ref; the default one is then skipped. The ref is
plugin scoped, so another plugin cannot use it: from another plugin, call
the [HTTP API](#http-api) as the user instead.

### `temporalControlExtensionPoint`

`./alpha`, `@alpha`. `addControlAction(action)` adds a custom operation,
served as `POST …/actions/:actionId` ([flow](#one-custom-action-from-the-button-to-temporal)).
`TemporalControlAction` has:

| Field        | Meaning                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | Letters, digits, `.`, `_`, `-`, starting with a letter; unique (a duplicate fails the startup)                                  |
| `permission` | A `catalog-entity` permission checked on the workflow's entity before `handle` runs                                             |
| `filter?`    | `(workflow: WorkflowDetail) => boolean`; false answers `409`                                                                    |
| `handle`     | `(ref, body, { entity?, workflow, credentials, client }) => Promise<JsonValue \| void>`; the value is sent back as `{ result }` |

The extension point is registered even when `temporal.control.enabled` is
false, so modules still start; their actions are then ignored with a
warning. The `client` reaches every workflow of the namespace with the
backend's credentials: an action that touches other workflows must check
them itself with `temporalAccessServiceRef`.

### `temporalWorkflowEnricherExtensionPoint`

`./alpha`, `@alpha`. `addWorkflowEnricher({ id, enrich })` adds data to
workflow summaries: `enrich(items, { entity?, namespace, credentials })`
runs, in the order the enrichers were added, where a workflow is read
through an entity: the workflow lists of an entity, and the details of a
workflow read through one (passed as `entityRef`, or the entity of its
search attribute when the list permissions do not allow it). It does not
run for the list of the Workflows page or for details allowed by the list
permissions. Put your data under `extensions[id]` of each summary
(`WorkflowSummary.extensions`); the fields you return are merged into the
summary. The frontend shows it nowhere by itself, so pair it with a
[tab or a button](#blueprints-and-props) that reads it. An enricher that
throws is skipped with a warning in the log; a second enricher with the same
`id` makes the plugin fail at startup. Do not rely on `entity` being set:
lists that span entities may run enrichers without one later.

<a id="llm-adapters"></a>

### `temporalLlmAdapterExtensionPoint`

`./alpha`, `@alpha`, experimental. `addLlmAdapter(adapter)` teaches the
backend the model calls of a framework: a step an adapter reads is shown
as a model call (messages, tool calls, tokens), any other step as a plain
step. The backend has built-in adapters for the official Temporal AI
integrations (`vercel-ai-sdk`, `openai-agents`, see the
[README](../README.md#model-calls-and-tool-calls)). A `TemporalLlmAdapter`
has:

| Member                           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                             | Unique; shown as the `framework` of the calls it reads. A taken ID (also a built-in one) fails the startup                                                                                                                                                                                                                                                                                                                     |
| `isModelCall(step)`              | From `TemporalLlmStep` (`kind`, `activityType`, `activityId?`, `summary?`; no payloads): may the step be one of your model calls? Only activities are read as model calls; true for a local activity is logged and has no effect. For the graph of a caller without the history permission the backend reads the result from External Storage, not the input (an input stored there is left out); the record route passes both |
| `readModelCalls(step, payloads)` | The model calls of the step, usually one, several when the step runs a whole agent (at most 100): `{ name?, record?, raw? }`, `record` a `WorkflowLlmRecord` of `./common`. Check the shape of `payloads` (`input?`, `result?`, `failureDetails?`); return `[]` when it does not match                                                                                                                                         |
| `readToolCall?(step, payloads)`  | Whether the step ran a tool a model call asked for: `{ toolName?, toolCallId?, modelCall? }`, else undefined                                                                                                                                                                                                                                                                                                                   |

The adapters of modules are asked first, in the order they were added, then
the built-in ones; the first that reads a step decides, and an adapter that
returns `[]` passes the step on. An adapter that throws, or returns
something that is not of these types or not plain JSON (cycles, functions,
class instances), makes that step a plain step and logs a warning with the
adapter ID, the event ID and the error name, once per adapter each time a
run is read; the error message is neither logged nor returned. Anyone can give an activity any name, so check the payloads before
you read a step as yours.

Tool calls are linked by the backend: a step whose adapter returns a
`toolCallId` is linked to the model call that asked for that ID; other
steps scheduled after the model call and before the next call of the agent
are matched by the tool name and the arguments, and marked `inferred`
(`WorkflowToolLink`, `WorkflowLlmToolCallRef`). The graph gets names and
numbers only (`WorkflowLlmSummary`), at the read level; the records need
the history level (`GET /:wf/llm-calls/:eventId`). [Example](#add-an-llm-adapter).

### Feature loader and catalog module

`backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))` adds
three features: `temporalPlugin`, `temporalAccessServiceFactory` and
`catalogModuleTemporalWorkflowKind`. The catalog module is a module of the
`catalog` plugin; in a backend without the catalog it is skipped, and a split
deployment adds it to the backend that runs the catalog. Without it the
catalog rejects `TemporalWorkflow` entities.

## Frontend extension

![Where frontend extensions appear. On the right, the pages of the entity tab and of the Workflows page: above a workflow list the list actions (Start workflow, then yours), on each schedule the schedule actions, on the details page of a run the actions in the action bar (Signal, Cancel and the other operations, then yours, before Query and Refresh) and the sections as tabs after Steps, Timeline, Events and Details. On the left, the new frontend system: the five blueprints attach to the inputs actions, sections, listActions and scheduleActions of api:temporal/workflow-extensions, which is not exported; the legacy system: the props workflowActions, workflowSections, workflowListActions and scheduleActions of EntityTemporalContent and TemporalPage, and createTemporalControlActionDef. Both meet at the same places, props first, one entry per id. Components get TemporalWorkflowExtensionProps or useTemporalWorkflow() and call the backend with temporalApiRef (api:temporal, TemporalClient).](images/frontend-mounts.svg)

### Blueprints and props

Both frontend systems fill the same four places on the same pages (the
entity tab and the Workflows page). The page takes the legacy props first,
then the extensions collected by `api:temporal/workflow-extensions`, and
keeps one entry per `id`.

| Place                          | New system (`./alpha`)                                              | Input             | Legacy prop (`EntityTemporalContent`, `TemporalPage`) | Component gets                    | `filter` gets      |
| ------------------------------ | ------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- | --------------------------------- | ------------------ |
| Action bar of the details page | `TemporalWorkflowActionBlueprint`, `TemporalControlActionBlueprint` | `actions`         | `workflowActions` (`TemporalWorkflowActionDef[]`)     | `TemporalWorkflowExtensionProps`  | `WorkflowDetail`   |
| Tabs of the details page       | `TemporalWorkflowSectionBlueprint` (needs `title`)                  | `sections`        | `workflowSections` (`TemporalWorkflowSectionDef[]`)   | `TemporalWorkflowExtensionProps`  | `WorkflowDetail`   |
| Above a workflow list          | `TemporalWorkflowListActionBlueprint`                               | `listActions`     | `workflowListActions`                                 | `TemporalWorkflowListActionProps` | `{ entity? }`      |
| Each row of a schedule list    | `TemporalScheduleActionBlueprint`                                   | `scheduleActions` | `scheduleActions`                                     | `TemporalScheduleActionProps`     | `TemporalSchedule` |

The plugin's own operations use the same places: in the new system they are
the extensions `temporal-workflow-action:temporal/controls`,
`temporal-workflow-list-action:temporal/start` and
`temporal-schedule-action:temporal/controls`; in the legacy system
`EntityTemporalContent` and `TemporalPage` put them before yours. They render
nothing when `temporal.control.enabled` is false, and neither do the buttons
of `TemporalControlActionBlueprint` and `createTemporalControlActionDef`.
Other extensions you write do not check that key.

The blueprints and the kind of the extensions they make:

| Blueprint                             | Kind                            |
| ------------------------------------- | ------------------------------- |
| `TemporalWorkflowActionBlueprint`     | `temporal-workflow-action`      |
| `TemporalControlActionBlueprint`      | `temporal-control-action`       |
| `TemporalWorkflowSectionBlueprint`    | `temporal-workflow-section`     |
| `TemporalWorkflowListActionBlueprint` | `temporal-workflow-list-action` |
| `TemporalScheduleActionBlueprint`     | `temporal-schedule-action`      |

`TemporalControlActionBlueprint` (and `createTemporalControlActionDef` in the
legacy system) is a ready-made action: a button that calls
`runWorkflowAction()` for a backend action. Its params are
`TemporalControlActionButtonOptions` (`actionId`, `label`, `confirm?`,
`body?(workflow)`, `permission?`) plus `filter?`. With `permission` the
button is disabled for users who lack it.

### `TemporalWorkflowExtensionProps`

What actions and sections receive as props, and what
`useTemporalWorkflow()` returns inside the details page (it throws
elsewhere; `TemporalWorkflowProvider` with the same value as `value` makes it
work in a test):

| Field               | Is                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workflow`          | The `WorkflowDetail` shown, with `extensions` from the enrichers                                                           |
| `entity?`           | The catalog entity the page is shown for; absent on the Workflows page                                                     |
| `reload()`          | Reads the workflow again, for example after your button changed it                                                         |
| `workflowHref(ref)` | The link of another run's details page on the same page (entity tab or Workflows page), for example a run you just started |

List actions get `{ entity?, workflowHref(ref) }`; schedule actions get
`{ schedule, entity?, reload() }`.

### `temporalApiRef`

`temporalApiRef` (`plugin.temporal.api`) and its interface `TemporalApi` are
the client of the [HTTP API](#http-api): reads (`listEntityWorkflows`,
`listWorkflows`, `getWorkflow`, `getWorkflowGraph`, …) and operations
(`startWorkflow`, `signalWorkflow`, `runWorkflowAction`, …). The methods on
one workflow take the `entityRef` the workflow is shown for, on which the
backend checks the permission. Your extensions and other plugins call it with `useApi`;
the plugin provides `TemporalClient` as the default (extension
`api:temporal` in the new system, `temporalPlugin` in the legacy one).

It is separate from the collection of extensions:
`api:temporal/workflow-extensions` only gathers the blueprints' output for
the pages, and is not exported. Replacing `api:temporal` changes how every
page and extension talks to the backend
([example](#override-an-extension)).

### Extension IDs

The plugin of the new system has these extensions. Change one with
`temporalPlugin.getExtension(id).override(...)` and
`temporalPlugin.withOverrides(...)`, or disable one in `app.extensions`:

| ID                                             | What                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `page:temporal`                                | Workflows page on `/temporal`                                         |
| `entity-content:temporal`                      | Temporal tab of entities                                              |
| `entity-card:temporal/workflow-summary`        | Summary card of `TemporalWorkflow` entities                           |
| `entity-card:temporal/related-workflows`       | Workflow entities card of entities that depend on them                |
| `api:temporal`                                 | `temporalApiRef`, default `TemporalClient`                            |
| `api:temporal/workflow-extensions`             | The collection point of the blueprints; can be disabled, not replaced |
| `temporal-workflow-action:temporal/controls`   | Signal, Update, Cancel, Terminate, Rerun                              |
| `temporal-workflow-list-action:temporal/start` | Start workflow                                                        |
| `temporal-schedule-action:temporal/controls`   | Pause, Resume, Run now                                                |

The modules add `entity-content:temporal/definition` (Zigflow) and
`scaffolder-form-field:scaffolder/temporal-workflow-picker` (Scaffolder).
Extensions you make with the blueprints get IDs of the form
`<kind>:<plugin ID>/<name>`, for example
`temporal-control-action:temporal/escalate` for the button of
`TemporalControlActionBlueprint.make({ name: 'escalate' })` in a module of
the `temporal` plugin.

### Routes and links

The plugin has two route refs: `root` (the Workflows page, `temporal:root`)
and `entityContent` (the entity tab, `temporal:entity-content`). In the
legacy system they are `temporalPlugin.routes.root` and
`temporalPlugin.routes.entityContent` of the main entry point; in the new
system the default export of `./alpha` has the same `routes`. Another plugin
links to the Workflows page with `useRouteRef(temporalPlugin.routes.root)`.

Below either page, the details of a run are at
`namespaces/:namespace/workflows/:workflowId[/runs/:runId]`: for the
Workflows page on `/temporal` that is
`/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId`, which
`buildWorkflowPath` of `./common` builds after the page path. The
`workflowUrl` output of the Scaffolder module uses this shape.

## HTTP API

Every route is under the backend plugin's base URL, `/api/temporal`, and
needs Backstage credentials: a user token, or a token of another backend
plugin on behalf of a user.

The contract of the HTTP API is the OpenAPI spec
[`plugins/temporal-backend/src/schema/openapi.yaml`](../plugins/temporal-backend/src/schema/openapi.yaml),
published with the backend package: every parameter, body and response,
and the permissions of each route. The route tests check requests and
responses against it, and CI validates it (`yarn lint:openapi`); see
[OpenAPI spec](../plugins/temporal-backend/README.md#openapi-spec). The
tables below are the overview.

> **Service credentials skip the policy.** A request with the credentials of
> a backend plugin itself (`auth.getOwnServiceCredentials()`) is a service
> principal, and Backstage allows every permission to a service principal
> without asking the permission policy (unless its token carries
> `accessRestrictions`). Such a caller can read and operate every workflow
> of the allowed namespaces. Use it only for code that may do everything the
> plugin can; to act with a user's permissions, use
> `auth.getPluginRequestToken({ onBehalfOf: <the user's credentials> })`
> ([example](#call-the-http-api-from-another-backend)).

`:wf` stands for `namespaces/:namespace/workflows/:workflowId`, optionally
followed by `/runs/:runId` (without a run ID the latest run). Every route
under `:wf` and the schedule operations take `?entityRef=`, the entity the
workflow is shown for.

#### Which entity a workflow is checked on

- With `entityRef`: the read (`temporal.workflow.read`) or history
  (`temporal.workflow.history.read`) permission on that entity, and the
  workflow must be one of its workflows (`404` otherwise).
- Without it: first the list permissions on the workflow itself
  (`temporal.workflow.list`, and `temporal.workflow.history.list` too for the
  history level), with their conditions. If they do not allow it, the
  entity in the workflow's `searchAttributes.entityRef` attribute is checked
  as above; a workflow without that attribute is refused (`403`).
- An operation then checks its own permission on the entity it was read
  through, else on the entity of its search attribute; a workflow with
  neither needs the permission allowed without conditions.

Errors are Backstage error bodies: `400` input, `401` no valid
credentials, `403` denied, `404` not found, `409` a conflict (the workflow
is not running, the action's filter refused it, or Temporal refused it: a
workflow ID already in use, a schedule in the wrong state), `503` Temporal
not reachable, Temporal refusing the backend's own credentials, or no
worker answering a query or an update in time.
Routes the backend does not serve answer `404` **without** a body: the
operations when `temporal.control.enabled` is false, and the definition route
without the Zigflow backend module. The two list routes take
`searchAttribute`, the name of a `Bool` search attribute that must be true.

Reads are always served:

| Method and path                                       | Permission                                             | Request                                                                                                             | Response                       |
| ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `GET /entities/:kind/:namespace/:name/workflows`      | `temporal.workflow.read` (entity)                      | `status`, `allRuns`, `searchAttribute`, `pageSize`, `pageToken`                                                     | `WorkflowListResponse`         |
| `GET /entities/:kind/:namespace/:name/workflow-stats` | `temporal.workflow.read` (entity)                      | `limit`                                                                                                             | `WorkflowStatsResponse`        |
| `GET /entities/:kind/:namespace/:name/schedules`      | `temporal.workflow.read` (entity)                      |                                                                                                                     | `TemporalScheduleListResponse` |
| `GET /workflows`                                      | `temporal.workflow.list` (conditions become a query)   | `namespace`, `status`, `allRuns`, `workflowType`, `workflowId` (prefix), `searchAttribute`, `pageSize`, `pageToken` | `WorkflowListResponse`         |
| `GET /schedules`                                      | `temporal.workflow.list`, unconditional                | `namespace`                                                                                                         | `TemporalScheduleListResponse` |
| `GET /:wf`                                            | read level                                             | `entityRef`                                                                                                         | `WorkflowDetail`               |
| `GET /:wf/graph`                                      | read level; inputs and results only with history level | `entityRef`                                                                                                         | `WorkflowGraphResponse`        |
| `GET /:wf/progress`                                   | read level                                             | `entityRef`                                                                                                         | `WorkflowProgressResponse`     |
| `GET /:wf/handlers`                                   | read level                                             | `entityRef`                                                                                                         | `WorkflowHandlersResponse`     |
| `GET /:wf/history`                                    | history level                                          | `entityRef`, `pageSize`, `pageToken`                                                                                | `WorkflowHistoryResponse`      |
| `GET /:wf/steps`                                      | history level                                          | `entityRef`                                                                                                         | `WorkflowStepsResponse`        |
| `GET /:wf/payloads/download`                          | history level                                          | `entityRef`, `key`                                                                                                  | The payload's bytes            |
| `POST /:wf/query`                                     | read level and `temporal.workflow.query`; audited      | `WorkflowMessageRequest`                                                                                            | `WorkflowMessageResponse`      |
| `GET /:wf/loops`                                      | read level. **Experimental**                           | `entityRef`                                                                                                         | `WorkflowLoopsResponse`        |
| `GET /:wf/llm-calls/:eventId`                         | history level. **Experimental**                        | `entityRef`, `index`                                                                                                | `WorkflowLlmCallResponse`      |

The read and history levels are decided as in
[Which entity a workflow is checked on](#which-entity-a-workflow-is-checked-on).
`GET /:wf/loops` answers `404` unless
`temporal.experimental.aiWorkflows` is true.

Operations are served unless `temporal.control.enabled` is false; then the
routes do not exist and answer `404` without an error body. Each one is
recorded with the auditor ([event IDs](#what-the-plugin-writes)):

| Method and path                                                               | Permission                                                                                                                  | Request                                           | Response                                         |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `POST /entities/:kind/:namespace/:name/workflows`                             | `temporal.workflow.start` on the entity (no read level); only its workflow types and task queue                             | `WorkflowStartRequest`                            | `201` `WorkflowStartResponse`                    |
| `POST /workflows`                                                             | `temporal.workflow.list` and `temporal.workflow.start`, both without conditions (no read level)                             | `WorkflowStartRequest`                            | `201` `WorkflowStartResponse`                    |
| `POST /:wf/signal`                                                            | read level and `temporal.workflow.signal`; running only                                                                     | `WorkflowMessageRequest`                          | `202` `{}`                                       |
| `POST /:wf/update`                                                            | read level and `temporal.workflow.update`; running only                                                                     | `WorkflowMessageRequest`                          | `WorkflowMessageResponse`                        |
| `POST /:wf/cancel`                                                            | read level and `temporal.workflow.cancel`; running only                                                                     |                                                   | `202` `{}`                                       |
| `POST /:wf/terminate`                                                         | read level and `temporal.workflow.terminate`; running only                                                                  | `{ reason? }`                                     | `{}`                                             |
| `POST /:wf/rerun`                                                             | read level and `temporal.workflow.rerun`                                                                                    | `{ workflowId? }`                                 | `201` `WorkflowStartResponse`                    |
| `POST /:wf/actions/:actionId`                                                 | read level, then the action's `permission`, then its `filter`; an unknown `actionId` answers `404`                          | any JSON                                          | `WorkflowMessageResponse` (`{ result }` or `{}`) |
| `POST /namespaces/:namespace/schedules/:scheduleId/(pause\|unpause\|trigger)` | `temporal.workflow.start` on `?entityRef=` (the schedule must start its workflows), else without conditions (no read level) | `TemporalScheduleNoteRequest` (not for `trigger`) | `202` `{}`                                       |

The Zigflow backend module adds
`GET /entities/:kind/:namespace/:name/definition` (`temporal.workflow.read`
on a `TemporalWorkflow` entity with `spec.definition`). These 25 routes
(15 reads, 9 operations, 1 of the Zigflow module) are the plugin's own.
Because the plugin uses the permissions registry (its permissions and the
`temporal-workflow` resource type), the backend also mounts the permission
framework's `GET /.well-known/backstage/permissions/metadata` and
`POST /.well-known/backstage/permissions/apply-conditions` under
`/api/temporal`; the permission backend calls them, not your code.

The path helpers of `./common` (`buildWorkflowPath`,
`buildEntityWorkflowsPath`, `buildWorkflowOperationPath`,
`buildWorkflowActionPath`, …) build these paths; prefer them to writing
paths by hand. From the browser, use `temporalApiRef` instead.

### One custom action, from the button to Temporal

![One custom action in nine steps. In the browser: (1) the button of TemporalControlActionBlueprint, with your params label, confirm, body, permission (disables the button) and filter (shows it); (2) TemporalApi.runWorkflowAction(); (3) POST /api/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId/actions/:actionId. In the backend: (4) the route exists only when temporal.control.enabled is true, and the actionId must be registered, else 404; (5) loadWorkflow() checks the namespace and the read level on the entity; (6) authorizeOn() checks the action’s permission, else 403; (7) the action’s filter, else 409; (8) the auditor records workflow-action; (9) action.handle() runs with the entity, workflow, credentials and Temporal client and calls Temporal. Its value comes back as { result } and the button shows it. Your code runs at steps 1, 7 and 9.](images/action-flow.svg)

The same order holds for the built-in operations, with their own
permission and without your code. A Query runs the same way under the read
routes, so it stays when the operations are off.

## Permissions

The plugin registers 11 permissions (`temporalPermissions` in `./common`;
`temporalControlPermissions` are the six that change workflows). Write
policies with these objects or names; the [README](../README.md#permissions)
explains each one and has policy examples.

| Permission                       | Export                                  | Resource type       | Turned off with the operations |
| -------------------------------- | --------------------------------------- | ------------------- | ------------------------------ |
| `temporal.workflow.read`         | `temporalWorkflowReadPermission`        | `catalog-entity`    |                                |
| `temporal.workflow.history.read` | `temporalWorkflowHistoryReadPermission` | `catalog-entity`    |                                |
| `temporal.workflow.list`         | `temporalWorkflowListPermission`        | `temporal-workflow` |                                |
| `temporal.workflow.history.list` | `temporalWorkflowHistoryListPermission` | `temporal-workflow` |                                |
| `temporal.workflow.query`        | `temporalWorkflowQueryPermission`       | `catalog-entity`    |                                |
| `temporal.workflow.start`        | `temporalWorkflowStartPermission`       | `catalog-entity`    | yes (also schedules)           |
| `temporal.workflow.signal`       | `temporalWorkflowSignalPermission`      | `catalog-entity`    | yes                            |
| `temporal.workflow.update`       | `temporalWorkflowUpdatePermission`      | `catalog-entity`    | yes                            |
| `temporal.workflow.cancel`       | `temporalWorkflowCancelPermission`      | `catalog-entity`    | yes                            |
| `temporal.workflow.terminate`    | `temporalWorkflowTerminatePermission`   | `catalog-entity`    | yes                            |
| `temporal.workflow.rerun`        | `temporalWorkflowRerunPermission`       | `catalog-entity`    | yes                            |

`catalog-entity` permissions take the catalog's rules and conditions
(`catalogConditions` of `@backstage/plugin-catalog-backend/alpha`). The
`temporal-workflow` resource type (`RESOURCE_TYPE_TEMPORAL_WORKFLOW`,
`temporalWorkflowPermissionResourceRef`) has four rules, and their
conditions are `temporalWorkflowConditions` with
`createTemporalWorkflowConditionalDecision` (`./alpha`):

| Rule                | Condition         | Params          |
| ------------------- | ----------------- | --------------- |
| `HAS_WORKFLOW_TYPE` | `hasWorkflowType` | `workflowTypes` |
| `HAS_TASK_QUEUE`    | `hasTaskQueue`    | `taskQueues`    |
| `IN_NAMESPACE`      | `inNamespace`     | `namespaces`    |
| `IS_INITIATOR`      | `isInitiator`     | `claims`        |

A module of the plugin adds rules with
`coreServices.permissionsRegistry.addPermissionRules` and
`temporalWorkflowPermissionResourceRef`; a rule's `toQuery` returns a
`TemporalWorkflowQuery` (a visibility query, or `{ namespaces }` or
`{ initiators }`). The permission of a custom action is a `catalog-entity`
permission, usually one of these.

## Configuration keys

All keys are under `temporal`. The schemas are the `config.d.ts` of three
packages: [`temporal-backend`](../plugins/temporal-backend/config.d.ts) (all
keys below except `definitions`), [`temporal-frontend`](../plugins/temporal-frontend/config.d.ts)
(the keys the browser sees) and
[`temporal-backend-module-zigflow`](../plugins/temporal-backend-module-zigflow/config.d.ts).
Defaults and meanings are in the [README](../README.md#configuration).

| Key                                                                                                                       | Read by                                                             | Visible in the browser |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `connection.address`                                                                                                      | backend (`temporalServiceRef`)                                      |                        |
| `connection.namespaces`, `connection.tls`, `connection.auth.type`                                                         | backend                                                             |                        |
| `connection.auth.token`                                                                                                   | backend; secret                                                     |                        |
| `connection.defaultNamespace`                                                                                             | backend, frontend, Scaffolder backend module                        | yes                    |
| `webUi.baseUrl`                                                                                                           | backend, frontend                                                   | yes                    |
| `searchAttributes.entityRef`, `searchAttributes.initiator`                                                                | backend                                                             |                        |
| `control.enabled`                                                                                                         | backend (mounts the operation routes), frontend (shows the buttons) | yes                    |
| `control.allowedSignals`, `control.allowedUpdates`                                                                        | backend (rejects), frontend (offers)                                | yes                    |
| `externalStorage.s3.bucket`, `.driverName`, `.endpoint`, `.region`, `.forcePathStyle`, `.maxInlineBytes`, `.previewBytes` | backend                                                             |                        |
| `externalStorage.s3.credentials.accessKeyId`, `.secretAccessKey`, `.sessionToken`                                         | backend; secret                                                     |                        |
| `externalStorage.s3.accountId`, `.defaultCredentials`                                                                     | backend (with Backstage's `aws` config)                             |                        |
| `definitions.maxBytes`, `definitions.readFileLocations`                                                                   | Zigflow backend module                                              |                        |
| `experimental.aiWorkflows`                                                                                                | backend, the loops. **Experimental**                                |                        |

The Scaffolder backend module also reads Backstage's own `app.baseUrl`, for
the `workflowUrl` output. With `externalStorage.s3.accountId`, the backend
also reads Backstage's `aws` config (`aws.accounts`, `aws.accountDefaults`,
`aws.mainAccount`) for that account; those keys belong to Backstage. The
`accountId` entry needs its own `roleName`, `accessKeyId` or `profile`
(otherwise the backend does not start), and with `defaultCredentials: true`
the backend reads `aws.mainAccount` to warn when Backstage's URL reader
shares the identity of the machine.

## Catalog: annotations and the `TemporalWorkflow` kind

Annotations on any entity (constants in `./common`):

| Annotation                  | Constant                            | Value                           |
| --------------------------- | ----------------------------------- | ------------------------------- |
| `temporal.io/namespace`     | `TEMPORAL_NAMESPACE_ANNOTATION`     | Namespace                       |
| `temporal.io/task-queue`    | `TEMPORAL_TASK_QUEUE_ANNOTATION`    | Task queue                      |
| `temporal.io/workflow-type` | `TEMPORAL_WORKFLOW_TYPE_ANNOTATION` | Workflow types, comma separated |

The kind: `apiVersion: temporal.io/v1alpha1`, `kind: TemporalWorkflow`
(`TemporalWorkflowEntityV1alpha1`, schema
`temporalWorkflowEntityV1alpha1Schema`), one entity per workflow type.

| `spec` field   | Required | Meaning                                                                                       |
| -------------- | -------- | --------------------------------------------------------------------------------------------- |
| `owner`        | yes      | Owner reference (`ownedBy` / `ownerOf`)                                                       |
| `workflowType` | yes      | The workflow type                                                                             |
| `taskQueue`    |          | Its task queue                                                                                |
| `namespace`    |          | Its namespace; default `connection.defaultNamespace`                                          |
| `system`       |          | System reference (`partOf` / `hasPart`)                                                       |
| `lifecycle`    |          | As on components                                                                              |
| `dependsOn`    |          | References (`dependsOn` / `dependencyOf`)                                                     |
| `exampleInput` |          | Arguments filled in "Start workflow"                                                          |
| `messages`     |          | `signals`, `updates`, `queries`: `name`, `description`, `inputSchema`, `example`, `userField` |
| `definition`   |          | `format` (`serverless-workflow` or `source`), `target`, `symbol` (Definition tab)             |

Other entities link to a workflow entity with the standard `spec.dependsOn`
(`temporalworkflow:default/order-workflow`). The
[README](../README.md#workflow-entities) has the details and examples.

## What the plugin writes

Other systems can read these, so they are interfaces too:

- **Search attributes.** Workflows started or rerun from Backstage (pages,
  API, Scaffolder) get the entity reference in
  `temporal.searchAttributes.entityRef` (start from an entity) and the user
  in `temporal.searchAttributes.initiator`, when those keys are set. Both
  must be `Keyword` attributes registered in Temporal. A rerun keeps the
  original run's attributes and sets the initiator.

  The plugin reads both attributes on **every** workflow, whoever set them:
  the entity reference adds the workflow to that entity's list and decides
  on which entity its permissions are checked, and the initiator is what the
  `IS_INITIATOR` rule compares. Code outside Backstage that starts workflows
  with these attributes gets the same effect, so set them only to the entity
  and user the workflow belongs to.

- **Identity.** Operations pass `backstage:<user entity ref>` (or
  `backstage:<service subject>`) as the Temporal identity, shown in the
  history.
- **Audit events** (auditor service, plugin `temporal`): `workflow-start`,
  `workflow-signal`, `workflow-update`, `workflow-query`, `workflow-cancel`,
  `workflow-terminate`, `workflow-rerun`, `workflow-action`,
  `schedule-pause`, `schedule-unpause`, `schedule-trigger`, with the
  namespace, workflow and entity in the metadata. Their severity is `low`
  for `workflow-query`, `high` for `workflow-terminate` and `medium` for the
  others.

The memo your workers write is read only by the experimental views
(below). The plugin also reads the references of Temporal External Storage,
written by the SDK's S3 driver in its own format.

## Scaffolder

`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal` adds
three template actions. They call the HTTP API of the plugin as the user who
runs the template (they may run in another backend than the plugin):

| Action                     | Input                                                                                                                                                                     | Output                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `temporal:workflow:start`  | `entityRef`, or `workflowType` and `taskQueue`; `namespace`, `workflowId`, `args`                                                                                         | `namespace`, `workflowId`, `runId`, `workflowUrl` |
| `temporal:workflow:wait`   | `workflowId`, `runId`, `namespace`, `entityRef`; `untilSearchAttribute`, `timeoutSeconds`, `intervalSeconds`, `maxIntervalSeconds`, `failIfNotCompleted`, `includeResult` | `status`, `runId`, `result`, `searchAttributes`   |
| `temporal:workflow:signal` | `workflowId`, `runId`, `namespace`, `entityRef`; `kind` (`signal` or `update`), `name`, `args`                                                                            | `result` (of an update)                           |

`start` and `signal` need the operations; `wait` only reads (the workflow,
and `/steps` for its result).
`@kwkevinchan/backstage-plugin-scaffolder-module-temporal` adds the form
field `TemporalWorkflowPicker`, whose value is a workflow ID; its
`ui:options` are `TemporalWorkflowPickerUiOptions` (`entityRef`,
`workflowType`, `namespace`, `status`, `searchAttribute`). The action
schemas are shown on the Scaffolder's actions page; see the
[module README](../plugins/scaffolder-backend-module-temporal/README.md).

## Zigflow

`temporal-backend-module-zigflow` serves the definition file of a
`TemporalWorkflow` entity (route above, keys `definitions.*`);
`temporal-module-zigflow` shows it on a **Definition** tab
(`EntityTemporalDefinitionContent` in the legacy system, mount it on
`/definition` of the workflow entity page;
`entity-content:temporal/definition` in the new one). The response of the
route (`WorkflowDefinitionResponse`) is not exported: the two modules are
released together and the route is for the tab only.

## Experimental: loops and model calls

> **Experimental. These will change substantially before the first
> release. Do not depend on them, except through an LLM adapter.**

- the loops: turned on with `temporal.experimental.aiWorkflows: true`, off
  by default. The route `GET /:wf/loops`, the `TemporalApi` method
  `getWorkflowLoops` (`@alpha`), the names of `loops.ts` in `./common`
  (table above), the fields `loop` and `loops` of `WorkflowGraphNode` and
  `WorkflowGraphResponse`, and the memo keys and query that
  `@kwkevinchan/temporal-workflow-kit` (not published) writes in workers.
  There are no examples for them on purpose.
- the model calls and tool calls: always on. The route
  `GET /:wf/llm-calls/:eventId`, the `TemporalApi` method `getLlmCall`
  (`@alpha`), the names of `llm.ts` in `./common`, the fields `llm` and
  `tool` of `WorkflowGraphNode` and `ActivityStep`, and
  [`temporalLlmAdapterExtensionPoint`](#llm-adapters). The markers and the
  record of `llm.ts` (`LLM_MARKER_PREFIX`, `LLM_RECORD_KEY`,
  `parseLlmMarker`, …) are the format of the workflow kit; they go away
  with it.
- the event groups: always on, read from the history. The names of
  `eventGroups.ts` in `./common`, the field `groups` of `WorkflowGraphNode`
  and the fields `eventGroups` and `eventGroupsTruncated` of
  `WorkflowGraphResponse` ([README](../README.md#event-groups)). They need
  Temporal server 1.32 or later and an SDK that writes Event Groups
  (TypeScript SDK 1.23 or later); without them the fields are left out.
  Event Groups are experimental in Temporal, so the shape follows it.

## Examples

Each example compiles against this repository; the development apps
(`packages/app`, `packages/app-next`, `packages/backend`) use the same
code. Imports use the full package names.

### Install

Backend, `packages/backend/src/index.ts`:

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
// Optional: the Definition tab and the template actions.
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow'),
);
backend.add(
  import('@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal'),
);
```

App, new frontend system:

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import temporalZigflowModule from '@kwkevinchan/backstage-plugin-temporal-module-zigflow/alpha';

export default createApp({
  features: [temporalPlugin, temporalZigflowModule /* ... */],
});
```

The legacy system and the catalog rules are in the
[README](../README.md#installation).

### Add a custom action

A backend module adds the action:

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { temporalControlExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';
import { temporalWorkflowUpdatePermission } from '@kwkevinchan/backstage-plugin-temporal-backend/common';

export const temporalModuleEscalate = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'escalate',
  register(reg) {
    reg.registerInit({
      deps: { temporal: temporalControlExtensionPoint },
      async init({ temporal }) {
        temporal.addControlAction({
          id: 'escalate',
          permission: temporalWorkflowUpdatePermission,
          filter: workflow => workflow.status === 'Running',
          async handle(ref, _body, { client }) {
            const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
            const result = await handle.executeUpdate('setPriority', {
              args: ['high'],
            });
            return result as { priority: string };
          },
        });
      },
    });
  },
});
```

and the app shows it as a button, in the new system:

```ts
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { TemporalControlActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import { temporalWorkflowUpdatePermission } from '@kwkevinchan/backstage-plugin-temporal-frontend/common';

const escalateButton = TemporalControlActionBlueprint.make({
  name: 'escalate',
  params: {
    actionId: 'escalate',
    label: 'Escalate',
    confirm: 'Raise the priority to high?',
    permission: temporalWorkflowUpdatePermission,
    filter: workflow => workflow.status === 'Running',
  },
});

export const temporalExtensionsModule = createFrontendModule({
  pluginId: 'temporal',
  extensions: [escalateButton],
});
```

or in the legacy system, in the `workflowActions` of
`EntityTemporalContent` and `TemporalPage`:

```tsx
<EntityTemporalContent
  workflowActions={[
    createTemporalControlActionDef({
      actionId: 'escalate',
      label: 'Escalate',
      filter: workflow => workflow.status === 'Running',
    }),
  ]}
/>
```

The development backend has a fuller one
(`packages/backend/src/escalateAction.ts`).

### Add an enricher

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { temporalWorkflowEnricherExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';

export const temporalModuleOwner = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'owner',
  register(reg) {
    reg.registerInit({
      deps: { temporal: temporalWorkflowEnricherExtensionPoint },
      async init({ temporal }) {
        temporal.addWorkflowEnricher({
          id: 'owner',
          async enrich(items, { entity }) {
            const owner = entity?.spec?.owner ?? null;
            return items.map(item => ({
              ...item,
              extensions: { ...item.extensions, owner },
            }));
          },
        });
      },
    });
  },
});
```

The value is then `workflow.extensions?.owner` in the frontend, as in the
next example, on the pages where the enricher runs (not on the Workflows
page; see [the extension point](#temporalworkflowenricherextensionpoint)).

### Add an LLM adapter

A module that reads the model calls of a framework whose model call
activity is `callModel` and returns `{ model, text, usage }`:

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { temporalLlmAdapterExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';

export const temporalModuleMyAgents = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'my-agents',
  register(reg) {
    reg.registerInit({
      deps: { llm: temporalLlmAdapterExtensionPoint },
      async init({ llm }) {
        llm.addLlmAdapter({
          id: 'my-agents',
          isModelCall: step => step.activityType === 'callModel',
          readModelCalls(_step, { result }) {
            const r = result as Record<string, any> | undefined;
            if (!r || typeof r.model !== 'string') return [];
            return [
              {
                record: {
                  requestModel: r.model,
                  usage: { inputTokens: r.usage?.input },
                  systemInstructions: [],
                  inputMessages: [],
                  outputMessages: [
                    {
                      role: 'assistant',
                      parts: [{ type: 'text', content: String(r.text) }],
                    },
                  ],
                  toolExecutions: [],
                },
                raw: r,
              },
            ];
          },
        });
      },
    });
  },
});
```

Add it with `backend.add(temporalModuleMyAgents)`. Steps of type
`callModel` whose result has another shape stay plain steps.

### Add a tab to the details page

```tsx
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { Text } from '@backstage/ui';
import { TemporalWorkflowSectionBlueprint } from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal-frontend';

export function OwnerSection(props: TemporalWorkflowExtensionProps) {
  const owner = props.workflow.extensions?.owner;
  return <Text>Owner: {typeof owner === 'string' ? owner : 'unknown'}</Text>;
}

const ownerSection = TemporalWorkflowSectionBlueprint.make({
  name: 'owner',
  params: {
    title: 'Owner',
    loader: async () => OwnerSection,
  },
});

export const temporalTabsModule = createFrontendModule({
  pluginId: 'temporal',
  extensions: [ownerSection],
});
```

Legacy system: pass
`workflowSections={[{ id: 'owner', title: 'Owner', component: OwnerSection }]}`
to `EntityTemporalContent` and `TemporalPage`. A component deeper in the tab
gets the same props with `useTemporalWorkflow()`. This tab reads data of the
enricher above, so on the Workflows page it shows "unknown".

### Override an extension

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

The `workflowUrl` output of the Scaffolder actions still points to
`/temporal`: the module builds it with that path.

`api:temporal` takes its params as a callback; give it your own
`TemporalApi` with
`params: defineParams => defineParams({ api: temporalApiRef, deps: {}, factory: () => myClient })`
([README](../README.md#extending)).

### Own `temporalServiceRef`

For example a connection with a client certificate. The factory must
implement the whole `TemporalService`, because the plugin uses every
member; add it to the backend next to the plugin
(`backend.add(mtlsTemporalServiceFactory)`):

```ts
import { readFileSync } from 'node:fs';
import {
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { Client, Connection } from '@temporalio/client';
import type { WorkflowRef } from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import {
  TemporalService,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';

export const mtlsTemporalServiceFactory = createServiceFactory({
  service: temporalServiceRef,
  deps: {
    config: coreServices.rootConfig,
    lifecycle: coreServices.rootLifecycle,
  },
  factory({ config, lifecycle }) {
    const address = config.getString('temporal.connection.address');
    const defaultNamespace =
      config.getOptionalString('temporal.connection.defaultNamespace') ??
      'default';
    const namespaces = [
      ...new Set([
        defaultNamespace,
        ...(config.getOptionalStringArray('temporal.connection.namespaces') ??
          []),
      ]),
    ];
    const webUi = config.getOptionalString('temporal.webUi.baseUrl');
    let connection: Promise<Connection> | undefined;
    const clients = new Map<string, Promise<Client>>();
    const service: TemporalService = {
      getConnection() {
        connection ??= Connection.connect({
          address,
          tls: {
            clientCertPair: {
              crt: readFileSync('/etc/temporal/tls.crt'),
              key: readFileSync('/etc/temporal/tls.key'),
            },
          },
        }).catch(error => {
          // Connect again on the next call instead of keeping the failure.
          connection = undefined;
          throw error;
        });
        return connection;
      },
      getClient(options) {
        const namespace = options?.namespace ?? defaultNamespace;
        if (!namespaces.includes(namespace)) {
          return Promise.reject(
            new Error(`Temporal namespace is not allowed: ${namespace}`),
          );
        }
        let client = clients.get(namespace);
        if (!client) {
          client = service
            .getConnection()
            .then(c => new Client({ connection: c, namespace }));
          client.catch(() => clients.delete(namespace));
          clients.set(namespace, client);
        }
        return client;
      },
      getDefaultNamespace: () => defaultNamespace,
      getAllowedNamespaces: () => [...namespaces],
      isNamespaceAllowed: namespace => namespaces.includes(namespace),
      getSearchAttributeNames: () => ({
        entityRef: config.getOptionalString(
          'temporal.searchAttributes.entityRef',
        ),
        initiator: config.getOptionalString(
          'temporal.searchAttributes.initiator',
        ),
      }),
      getWebUiUrl(ref: WorkflowRef) {
        if (!webUi) return undefined;
        const workflow = `${webUi}/namespaces/${encodeURIComponent(
          ref.namespace,
        )}/workflows/${encodeURIComponent(ref.workflowId)}`;
        // The Web UI addresses a run as …/workflows/:workflowId/:runId/history.
        return ref.runId
          ? `${workflow}/${encodeURIComponent(ref.runId)}/history`
          : workflow;
      },
    };
    lifecycle.addShutdownHook(async () => {
      if (connection) await (await connection).close();
    });
    return service;
  },
});
```

To only use the connection from your own plugin, depend on
`temporalServiceRef` instead
([README](../README.md#extending)).

### Call the HTTP API from another backend

As the user of a request (`credentials` from `httpAuth.credentials(req)`),
so the plugin's permission checks and audit records apply, as the Scaffolder
module does:

```ts
import {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { ResponseError } from '@backstage/errors';
import {
  buildEntityWorkflowsPath,
  WorkflowListResponse,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';

export async function listRunningWorkflows(
  services: { discovery: DiscoveryService; auth: AuthService },
  entityRef: string,
  credentials: BackstageCredentials,
): Promise<WorkflowListResponse> {
  const baseUrl = await services.discovery.getBaseUrl('temporal');
  const { token } = await services.auth.getPluginRequestToken({
    onBehalfOf: credentials,
    targetPluginId: 'temporal',
  });
  const path = buildEntityWorkflowsPath(parseEntityRef(entityRef));
  const response = await fetch(`${baseUrl}${path}?status=Running`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await ResponseError.fromResponse(response);
  return (await response.json()) as WorkflowListResponse;
}
```

Do not replace the user's credentials with
`auth.getOwnServiceCredentials()` to get around a denial: a service
principal is allowed every permission without the policy being asked (see
[HTTP API](#http-api)). From a frontend plugin, use `useApi(temporalApiRef)`
instead (`listEntityWorkflows(entityRef, { status: 'Running' })`).

## Not public

Questions that come up, and what to use instead:

| You look for                                                                 | Why it is not exported                                   | Use                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DefaultTemporalService`, or a way to wrap the built-in connection           | Its options follow the config schema, which may change   | Depend on `temporalServiceRef`, or implement `TemporalService` ([example](#own-temporalserviceref)) |
| `DefaultTemporalAccessService`                                               | The checks are one contract through the interface        | `temporalAccessServiceRef`, or your own factory for it                                              |
| The routers, `WorkflowQueries`, `WorkflowCommands`, the repositories         | Internal layers, wired by `plugin.ts`                    | The HTTP API, the extension points                                                                  |
| `temporalWorkflowExtensionsApiRef`, `TemporalWorkflowExtensionsApi`          | The collection of blueprints is an implementation detail | The blueprints; disable `api:temporal/workflow-extensions` to remove every extension                |
| The plugin's extensions by name (`temporalPage`, …)                          | Exported extensions would freeze their params            | `getExtension(id)` and `withOverrides()` ([IDs](#extension-ids))                                    |
| The Zigflow types (`WorkflowDefinitionResponse`, …)                          | The route serves only the Definition tab                 | The Definition tab                                                                                  |
| A frontend import of `@kwkevinchan/backstage-plugin-temporal-backend/common` | A frontend plugin must not import a backend plugin       | `@kwkevinchan/backstage-plugin-temporal-frontend/common`, the same definitions                      |
| `./ui` components in your own plugin                                         | No compatibility promise; made for the Zigflow module    | `@backstage/ui`                                                                                     |

## Keeping this guide true

Each published package has an API report per entry point, `report.api.md`
and `report-<entry>.api.md` next to its `package.json`, made by
[API Extractor](https://api-extractor.com/) through
`@backstage/repo-tools` as in the Backstage repository. CI (the **API
reports** step of the Verify job, after the type check) fails when a report
no longer matches the exports. After changing an export:

```sh
yarn build:api-reports   # type check, then write the reports
```

and commit the changed reports with the code. A change of a public
interface then shows up in the pull request as a diff of the report. The
HTTP API has its own contract, the
[OpenAPI spec](../plugins/temporal-backend/src/schema/openapi.yaml): change
it together with the routes; the route tests and `yarn lint:openapi` check
it. Update
this guide in the same pull request when the change adds, removes or
renames a name listed here.

Some reports carry warnings that API Extractor writes into them
(`// Warning: ...`), allowed for `temporal-backend` and `temporal-frontend`
(`--allow-warnings`); a new warning still shows up in the report diff. Most
are expected: a type of one entry point that names a type of another entry
point of the same package (for example `TemporalApi` and the response types
of `./common`), which this repository does not export twice. The others are
the experimental fields of the graph types (`@public` types that reference
`@alpha` ones), which change with the experimental views.

Back to [the documentation index](README.md).
