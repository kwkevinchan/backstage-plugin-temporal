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
- [Experimental: model calls and event groups](#experimental-model-calls-and-event-groups)
- [Examples](#examples)
- [Not public](#not-public)
- [Keeping this guide true](#keeping-this-guide-true)

## Stability

Every exported name carries a release tag in its doc comment, and the
[API reports](#keeping-this-guide-true) show it on each line:

| Tag          | Meaning                                                                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@public`    | Part of the supported API. Until `1.0.0` a minor version may still change it, and the changelog says so ([README](../README.md)).                                                                                                            |
| `@alpha`     | Usable, with no compatibility promise between versions. The `./alpha` entry points hold only these; so does `./ui` (it breaks only in a minor version, see [`temporal`](#temporal)), and `./common` has 13 of them (the experimental names). |
| Experimental | The model call types and Event Groups. They will change substantially before the first release; see [Experimental](#experimental-model-calls-and-event-groups). Do not build on them.                                                        |

The HTTP API, the permissions, the configuration keys, the annotations, the
kind and the search attributes have no tag of their own: they follow the
package that serves or reads them (`temporal-backend`, `@public`), except the
experimental routes and key.

## Where the interfaces are

![Where the interfaces of the plugin are. In the Backstage app, your app and plugins use the npm entry points of temporal (1) and its extensions: blueprints, props and temporalApiRef (2). The browser, other backend plugins, the Scaffolder module and the actions module call the HTTP API under /api/temporal (3). In the Backstage backend, your modules use the extension points and service refs (4), your permission policy the permissions and conditions (5), the catalog gets the TemporalWorkflow kind, and the plugin reads that kind and the annotations of entities (6), and app-config holds the temporal keys (7). The backend reaches Temporal with @temporalio/client and writes search attributes, the identity and audit events (8). Workers run your workflow code.](images/interfaces-overview.svg)

Each number is one kind of interface; the sections below follow them.
Teal is what the frontend uses, orange what backend code uses, purple
what crosses a process boundary (HTTP, Temporal).

1. **npm entry points** of the seven packages ([npm entry points](#npm-entry-points)).
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

![The seven published packages and their entry points, with the number of names, the release tag and the API report file of each. temporal-backend: . 3 public (report.api.md), ./alpha 17 alpha (report-alpha.api.md), ./node 12 public (report-node.api.md), ./common 110, of which 97 public and 13 experimental alpha (report-common.api.md). temporal: . 22 public, ./alpha 6 alpha, ./common the same 110, ./ui 26 alpha, for companion packages only (report-ui.api.md). temporal-backend-module-zigflow: . 1 public. temporal-module-zigflow: . 1 public, ./alpha 2 alpha. temporal-backend-module-actions: . 1 public. scaffolder-backend-module-temporal: . 1 public. scaffolder-module-temporal: . 2 public, ./alpha 2 alpha.](images/entry-points.svg)

All package names start with `@kwkevinchan/backstage-plugin-`. The full,
generated list of each entry point is its API report (the last column);
the tables below say what each name is for.

| Package                              | Entry      | Names | Tag                       | For                                                   | API report                                                                         |
| ------------------------------------ | ---------- | ----: | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `temporal-backend`                   | `.`        |     3 | `@public`                 | Installing the backend                                | [`report.api.md`](../plugins/temporal-backend/report.api.md)                       |
|                                      | `./node`   |    12 | `@public`                 | Other backend code that needs Temporal                | [`report-node.api.md`](../plugins/temporal-backend/report-node.api.md)             |
|                                      | `./alpha`  |    17 | `@alpha`                  | Backend modules and permission policies               | [`report-alpha.api.md`](../plugins/temporal-backend/report-alpha.api.md)           |
|                                      | `./common` |   110 | `@public` 97, `@alpha` 13 | Types, paths, permissions, annotations (backend code) | [`report-common.api.md`](../plugins/temporal-backend/report-common.api.md)         |
| `temporal`                           | `.`        |    22 | `@public`                 | Legacy frontend system, and types for extensions      | [`report.api.md`](../plugins/temporal/report.api.md)                               |
|                                      | `./alpha`  |     6 | `@alpha`                  | New frontend system: the plugin and the blueprints    | [`report-alpha.api.md`](../plugins/temporal/report-alpha.api.md)                   |
|                                      | `./common` |   110 | `@public` 97, `@alpha` 13 | The same definitions, for frontend code               | [`report-common.api.md`](../plugins/temporal/report-common.api.md)                 |
|                                      | `./ui`     |    26 | `@alpha`                  | Companion packages of this repository only            | [`report-ui.api.md`](../plugins/temporal/report-ui.api.md)                         |
| `temporal-backend-module-zigflow`    | `.`        |     1 | `@public`                 | Installing the module                                 | [`report.api.md`](../plugins/temporal-backend-module-zigflow/report.api.md)        |
| `temporal-module-zigflow`            | `.`        |     1 | `@public`                 | Legacy frontend system                                | [`report.api.md`](../plugins/temporal-module-zigflow/report.api.md)                |
|                                      | `./alpha`  |     2 | `@alpha`                  | New frontend system                                   | [`report-alpha.api.md`](../plugins/temporal-module-zigflow/report-alpha.api.md)    |
| `temporal-backend-module-actions`    | `.`        |     1 | `@public`                 | Installing the module                                 | [`report.api.md`](../plugins/temporal-backend-module-actions/report.api.md)        |
| `scaffolder-backend-module-temporal` | `.`        |     1 | `@public`                 | Installing the module                                 | [`report.api.md`](../plugins/scaffolder-backend-module-temporal/report.api.md)     |
| `scaffolder-module-temporal`         | `.`        |     2 | `@public`                 | Legacy frontend system                                | [`report.api.md`](../plugins/scaffolder-module-temporal/report.api.md)             |
|                                      | `./alpha`  |     2 | `@alpha`                  | New frontend system                                   | [`report-alpha.api.md`](../plugins/scaffolder-module-temporal/report-alpha.api.md) |

`./common` of the frontend is a generated copy of the backend's (a frontend
plugin may not import a backend plugin); both reports are identical. Import
it from the package of your side. The entry points for modules (`./node`,
`./alpha`, `./common` of the backend) do not load the plugin itself.

### `temporal-backend`

| Name                                                                                                                            | Entry     | What it is                                                                                               | Use it when                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `default`                                                                                                                       | `.`       | Feature loader: `temporalPlugin`, `temporalAccessServiceFactory` and `catalogModuleTemporalWorkflowKind` | You install the backend: `backend.add(import('…-temporal-backend'))`                                 |
| `temporalPlugin`                                                                                                                | `.`       | The backend plugin (`pluginId: 'temporal'`)                                                              | You add the features one by one, for example without the catalog module                              |
| `catalogModuleTemporalWorkflowKind`                                                                                             | `.`       | Catalog module (`catalog` / `temporal-workflow-kind`) with the processor of the kind                     | The catalog runs in another backend than the plugin                                                  |
| `temporalServiceRef`                                                                                                            | `./node`  | Root service ref of the shared Temporal connection (`temporal.client`)                                   | Other backend code calls Temporal, or you replace the connection                                     |
| `TemporalService`                                                                                                               | `./node`  | Its interface: `getClient()`, `getConnection()`, the namespaces, search attribute names, Web UI links    | You use or implement the service                                                                     |
| `DefaultTemporalService`, `readTemporalServiceOptions`, `TemporalServiceOptions`, `TemporalConnectionAuth`                      | `./node`  | The default implementation of the service and its options from config                                    | You extend the connection, for example with client certificates ([example](#own-temporalserviceref)) |
| `TemporalSearchAttributeNames`                                                                                                  | `./node`  | `{ entityRef?, initiator? }`, the configured attribute names                                             | You read `getSearchAttributeNames()`                                                                 |
| `TemporalPluginClient`                                                                                                          | `./node`  | Client of the routes of the plugin, as a user (used by the Scaffolder and actions registry modules)      |
| `buildWorkflowUrl`, `continuedAsNewRunIdOf`                                                                                     | `./node`  | The link to a run in Backstage; the run a refused operation continued as                                 |
| `resolveWorkflowNamespace`, `WorkflowNamespaceOptions`                                                                          | `./node`  | The namespace of a workflow: given, of the entity, or the default                                        |
| `temporalAccessServiceRef`                                                                                                      | `./alpha` | Plugin-scoped service ref of the access checks (`temporal.access`)                                       | Your module serves routes and needs the same checks, or decides access itself                        |
| `temporalAccessServiceFactory`                                                                                                  | `./alpha` | The default factory of that ref                                                                          | You add `temporalPlugin` alone                                                                       |
| `TemporalAccessService` and its types `TemporalAccessibleWorkflow`, `TemporalEntityContext`, `TemporalWorkflowEntityLoadResult` | `./alpha` | The access interface ([below](#temporalaccessserviceref))                                                | As above                                                                                             |
| `temporalControlExtensionPoint`, `TemporalControlExtensionPoint`, `TemporalControlAction`, `TemporalControlActionContext`       | `./alpha` | Custom workflow actions                                                                                  | You add an operation of your own                                                                     |
| `temporalWorkflowPermissionResourceRef`, `TemporalWorkflowFilter`                                                               | `./alpha` | The `temporal-workflow` permission resource and what a rule turns into for lists                         | You add permission rules                                                                             |
| `temporalWorkflowPermissionRules`                                                                                               | `./alpha` | The four rules of that resource                                                                          | You build conditions with other helpers                                                              |
| `temporalWorkflowConditions`, `createTemporalWorkflowConditionalDecision`                                                       | `./alpha` | Conditions and conditional decisions for the list permission                                             | Your permission policy                                                                               |
| `inCondition`, `quote`                                                                                                          | `./alpha` | Build a condition of a visibility query from checked values; both refuse unsafe values                   | The `toQuery` of your permission rule                                                                |

### `./common` (both core packages)

The 110 names in groups. Every name is in the
[report](../plugins/temporal-backend/report-common.api.md).

| Group (source file)                              | Names                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Used by                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Workflows (`types.ts`, 20)                       | `WorkflowRef`, `WorkflowRunRef`, `WorkflowSummary`, `WorkflowDetail`, `WorkflowStatus`, `WORKFLOW_STATUSES`, `WorkflowFailure`, `PendingActivity`, `RelatedWorkflows`, `WorkflowListResponse`, `WorkflowTypeOverview`, `WorkflowTypeOverviewRun`, `WorkflowTypeOverviewRequest`, `WorkflowTypeOverviewResponse`, `MAX_WORKFLOW_TYPE_OVERVIEW_REFS`, `WorkflowHistoryEvent`, `WorkflowHistoryResponse`, `WorkflowResultResponse`, `DecodedPayload`, `ExternalPayload` | Clients of the HTTP API, actions                                                                      |
| Graph and progress (`graph.ts`, 10)              | `WorkflowGraphResponse`, `WorkflowGraphNode`, `WorkflowGraphEdge`, `WorkflowNodeKind`, `WorkflowNodeStatus`, `WorkflowNodeAttempt`, `WorkflowNodeEvent`, `WorkflowDeadline`, `WorkflowRunChain`, `WorkflowProgressResponse`                                                                                                                                                                                                                                          | Clients of `…/graph` and `…/progress`                                                                 |
| Operations (`controls.ts`, 12)                   | `WorkflowControlOperation`, `WorkflowMessageRequest`, `WorkflowUpdateRequest`, `WorkflowMessageResponse`, `WorkflowIdReusePolicy`, `WorkflowStartRequest`, `WorkflowStartResponse`, `WorkflowMessageDefinition`, `WorkflowMessageDefinitionsResponse`, `buildWorkflowOperationPath`, `buildWorkflowActionPath`, `buildWorkflowMessageDefinitionsPath`                                                                                                                | Clients that operate workflows                                                                        |
| Schedules (`schedules.ts`, 8)                    | `TemporalSchedule`, `TemporalScheduleAction`, `TemporalScheduleListResponse`, `TemporalScheduleNoteRequest`, `TemporalScheduleOperation`, `SCHEDULES_PATH`, `buildEntitySchedulesPath`, `buildScheduleOperationPath`                                                                                                                                                                                                                                                 | Clients of the schedule routes                                                                        |
| Paths (`paths.ts`, 5)                            | `buildWorkflowPath`, `buildWorkflowRunPath`, `buildEntityWorkflowsPath`, `WORKFLOWS_PATH`, `WORKFLOW_TYPE_OVERVIEW_PATH`                                                                                                                                                                                                                                                                                                                                             | Building HTTP API paths                                                                               |
| Permissions (`permissions.ts`, 12)               | The 9 permissions (`temporalWorkflowReadPermission` … `temporalWorkflowRerunPermission`, see [Permissions](#permissions)), `temporalPermissions`, `temporalControlPermissions`, `RESOURCE_TYPE_TEMPORAL_WORKFLOW`                                                                                                                                                                                                                                                    | Permission policies, actions, buttons                                                                 |
| Annotations (`annotations.ts`, 12)               | `TEMPORAL_NAMESPACE_ANNOTATION`, `TEMPORAL_TASK_QUEUE_ANNOTATION`, `TEMPORAL_WORKFLOW_TYPE_ANNOTATION`, `TemporalAnnotations`, `parseTemporalAnnotations`, `InvalidTemporalAnnotationError`, `isTemporalAvailable`, `getDependsOnTemporalWorkflowRefs`, `isValidNamespaceName`, `isValidTaskQueueName`, `isValidWorkflowTypeName`, `isValidWorkflowIdPrefix`                                                                                                         | Entity pages, catalog processors, validation                                                          |
| `TemporalWorkflow` kind (`workflowEntity.ts`, 9) | `TEMPORAL_WORKFLOW_API_VERSION`, `TEMPORAL_WORKFLOW_KIND`, `TemporalWorkflowEntityV1alpha1`, `isTemporalWorkflowEntity`, `isTemporalWorkflowEntityRef`, `parseTemporalWorkflowSpec`, `InvalidTemporalWorkflowSpecError`, `getTemporalWorkflowSource`, `getTemporalWorkflowExampleArgs`                                                                                                                                                                               | Code that reads workflow entities                                                                     |
| Messages (`messages.ts`, 5)                      | `TemporalWorkflowMessageSpec`, `TemporalWorkflowMessagesSpec`, `getTemporalWorkflowMessages`, `mergeWorkflowMessageDefinitions`, `exampleArgs`                                                                                                                                                                                                                                                                                                                       | `spec.messages` of the kind                                                                           |
| Definition (`definition.ts`, 4)                  | `TEMPORAL_DEFINITION_FORMATS`, `TemporalDefinitionFormat`, `TemporalWorkflowDefinitionSpec`, `getTemporalWorkflowDefinitionSpec`                                                                                                                                                                                                                                                                                                                                     | `spec.definition` of the kind                                                                         |
| Experimental LLM (`llm.ts`, 11)                  | `addLlmUsage`, `buildLlmCallPath`, `WorkflowLlmCallResponse`, `WorkflowLlmMessage`, `WorkflowLlmPart`, `WorkflowLlmRecord`, `WorkflowLlmRecordState`, `WorkflowLlmSummary`, `WorkflowLlmToolCallRef`, `WorkflowLlmUsage`, `WorkflowLlmToolLink`                                                                                                                                                                                                                      | [Experimental](#experimental-model-calls-and-event-groups): do not use                                |
| Experimental event groups (`eventGroups.ts`, 2)  | `WorkflowEventGroup`, `WorkflowEventGroupKind`                                                                                                                                                                                                                                                                                                                                                                                                                       | [Experimental](#experimental-model-calls-and-event-groups): Event Groups are experimental in Temporal |

`DecodedPayload` keeps its three shapes (`{ encoding, value }`,
`{ encoding, size, undecodable: true, metadata? }` and
`{ encoding, external }`); later versions only add optional fields.

### `temporal`

| Name                                                                                                                                                                              | Entry     | What it is                                                                        | Use it when                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `default`                                                                                                                                                                         | `./alpha` | The plugin for the new frontend system, with 9 extensions ([IDs](#extension-ids)) | You install it in a new-system app                          |
| `TemporalWorkflowActionBlueprint`, `TemporalWorkflowSectionBlueprint`, `TemporalWorkflowListActionBlueprint`, `TemporalScheduleActionBlueprint`, `TemporalControlActionBlueprint` | `./alpha` | The five blueprints ([below](#blueprints-and-props))                              | You add a button, a tab or a control                        |
| `temporalPlugin`                                                                                                                                                                  | `.`       | The plugin for the legacy system                                                  | `createApp({ plugins: [...] })` of a legacy app             |
| `EntityTemporalContent`, `EntityTemporalContentProps`                                                                                                                             | `.`       | The entity tab, and its props                                                     | Legacy `EntityPage.tsx`                                     |
| `TemporalPage`, `TemporalPageProps`                                                                                                                                               | `.`       | The Temporal page, and its props                                                  | Legacy `App.tsx`                                            |
| `EntityTemporalWorkflowSummaryCard`, `EntityTemporalRelatedWorkflowsCard`                                                                                                         | `.`       | Overview cards of `TemporalWorkflow` entities and of entities that depend on them | Legacy entity pages                                         |
| `isTemporalAvailable`, `isTemporalWorkflowEntity`, `getDependsOnTemporalWorkflowRefs`                                                                                             | `.`       | Conditions for `EntitySwitch` and `if` (also in `./common`)                       | Legacy entity pages                                         |
| `TemporalWorkflowActionDef`, `TemporalWorkflowSectionDef`, `TemporalWorkflowListActionDef`, `TemporalScheduleActionDef`                                                           | `.`       | What the legacy props take                                                        | Legacy props                                                |
| `TemporalWorkflowExtensionProps`, `TemporalWorkflowListActionProps`, `TemporalScheduleActionProps`                                                                                | `.`       | Props your components receive, in both systems                                    | Writing a button, tab or control                            |
| `createTemporalControlActionDef`, `TemporalControlActionButtonOptions`                                                                                                            | `.`       | A legacy action whose button runs a custom backend action                         | Legacy `workflowActions`                                    |
| `temporalApiRef`, `TemporalApi`, `TemporalClient`                                                                                                                                 | `.`       | The client of the backend: ref, interface and default implementation              | Another plugin calls the backend, or you replace the client |

`./ui` (graph canvas, status helpers, panels, class names, `entityContentRouteRef`) exists for
`temporal-module-zigflow`, which is released with the same version. Its
names are `@alpha`: a change that breaks them comes only in a version that
a `^` range does not take (a minor version while the plugin is `0.x`), so
the module's `^` dependency on this package stays safe. Other packages
should not use it.

### Modules

| Package                              | Name                                                                      | Entry     | What it is                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `temporal-backend-module-zigflow`    | `default`                                                                 | `.`       | Backend module `temporal` / `zigflow`: the definition route                                      |
| `temporal-module-zigflow`            | `EntityTemporalDefinitionContent`                                         | `.`       | Legacy Definition tab                                                                            |
|                                      | `default`, `temporalDefinitionContent`                                    | `./alpha` | Frontend module of `temporal` with `entity-content:temporal/definition`                          |
| `temporal-backend-module-actions`    | `default`                                                                 | `.`       | Backend module `temporal` / `actions`: five actions of the actions registry                      |
| `scaffolder-backend-module-temporal` | `default`                                                                 | `.`       | Backend module `scaffolder` / `temporal`: the four template actions                              |
| `scaffolder-module-temporal`         | `TemporalWorkflowPickerFieldExtension`, `TemporalWorkflowPickerUiOptions` | `.`       | Legacy form field and its `ui:options`                                                           |
|                                      | `default`, `temporalWorkflowPickerFormField`                              | `./alpha` | Frontend module of `scaffolder` with `scaffolder-form-field:scaffolder/temporal-workflow-picker` |

## Backend extension

![Inside temporal-backend a request goes down four layers: routes (router.ts for reads and Query; controlRoutes.ts for the operations, mounted only when temporal.control.enabled is true), access (TemporalAccessService, the ref temporalAccessServiceRef, with the permission framework and the catalog), services (WorkflowQueries and the other query classes, WorkflowCommands) and TemporalService (temporalServiceRef, root scope) to Temporal. On the left, the modules of the plugin: temporalControlExtensionPoint adds actions to the operation routes, your own routes use temporalAccessServiceRef, and the Zigflow module adds a route under /api/temporal and checks the read permission through temporalAccessServiceRef. On the right, other backend code: the Scaffolder module calls the HTTP API as the user, your other plugin depends on temporalServiceRef, and your own factories for temporalAccessServiceRef or temporalServiceRef replace the default ones.](images/backend-interfaces.svg)

Four interfaces. The plugin creates the rest of the classes itself; they are not exported (see [Not public](#not-public)).

### `temporalServiceRef`

`@kwkevinchan/backstage-plugin-temporal-backend/node`, `@public`. A
**root**-scoped service: one Temporal connection for the whole backend, read
from `temporal.connection`. Its default factory comes with the ref, so any
plugin or module can depend on it without installing anything else.

| Member                          | Returns                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `getClient({ namespace? })`     | A `@temporalio/client` `Client`; rejects a namespace that is not allowed                                       |
| `getConnection({ namespace? })` | The `Connection` of a namespace; the default service has one for all (opened on first use, closed on shutdown) |
| `getDefaultNamespace()`         | `temporal.connection.defaultNamespace`                                                                         |
| `isNamespaceAllowed(ns)`        | Whether `ns` is in `temporal.connection.namespaces` (always with the default)                                  |
| `getSearchAttributeNames()`     | `TemporalSearchAttributeNames` from `temporal.searchAttributes`                                                |
| `getWebUiUrl(ref)`              | Link to the Temporal Web UI, or undefined without `temporal.webUi.baseUrl`                                     |

The plugin itself uses this service for every call to Temporal, reads and
operations alike, each on `getConnection({ namespace })` under
`Connection.withDeadline`. The client of `getClient({ namespace })` must use
that same connection: the deadline of a custom action is set on it, and the
calls of a client on another connection run without a deadline. Adding your
own factory for the ref replaces the connection everywhere
([example](#own-temporalserviceref)), for example for client certificates
(mTLS), which the configuration does not support. `DefaultTemporalService`
(the default implementation) and `readTemporalServiceOptions` (its options
from `temporal`) are exported for that: extend the class and override
`getConnection` and `close`.

### `temporalAccessServiceRef`

`./alpha`, `@alpha`. A **plugin**-scoped service of the `temporal` plugin:
the checks every route of the plugin runs. Modules of the plugin (that is,
`createBackendModule({ pluginId: 'temporal' })`) use it in their own routes
so that "who may see this workflow" has one definition.

| Method                                                      | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadWorkflow(ref, { entityRef?, credentials })`            | Reads a workflow with every check: the namespace, then, with `entityRef`, the read permission on that entity; without it, first the list permission on the workflow itself, else the permission on the entity in its entity search attribute ([order](#which-entity-a-workflow-is-checked-on)). Returns `matchedEntityRef` when the workflow belongs to the entity through a `TemporalWorkflow` entity it depends on: check your permissions on that entity too |
| `authorizeOn(permission, entityRef, credentials)`           | Checks a `catalog-entity` permission on an entity; without one, requires an unconditional ALLOW                                                                                                                                                                                                                                                                                                                                                                 |
| `loadEntity(entityRef, permission, credentials)`            | Checks the permission, then reads the entity and the `TemporalWorkflow` entities it depends on                                                                                                                                                                                                                                                                                                                                                                  |
| `loadWorkflowEntities(entityRefs, permission, credentials)` | Checks the permission on several `TemporalWorkflow` entities in one request, then reads the allowed ones; the others are left out, and an entity whose workflows cannot be shown comes with `error`                                                                                                                                                                                                                                                             |
| `canListAll`, `authorizeWorkflowList`                       | The list permission and its visibility query                                                                                                                                                                                                                                                                                                                                                                                                                    |

The package's default export installs the default factory
(`temporalAccessServiceFactory`). To decide access in another way, add a
factory of your own for the ref; the default one is then skipped. The ref is
plugin scoped, so another plugin cannot use it: from another plugin, call
the [HTTP API](#http-api) as the user instead.

### `temporalControlExtensionPoint`

`./alpha`, `@alpha`. `addControlAction(action)` adds a custom operation,
served as `POST …/actions/:actionId` ([flow](#one-custom-action-from-the-button-to-temporal)).
`TemporalControlAction` has:

| Field        | Meaning                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | Letters, digits, `.`, `_`, `-`, starting with a letter; unique (a duplicate fails the startup)                                                                                                                                                                                                                                                       |
| `permission` | A `catalog-entity` permission checked on the workflow's entity before `handle` runs                                                                                                                                                                                                                                                                  |
| `filter?`    | `(workflow: WorkflowDetail) => boolean`; false answers `409`                                                                                                                                                                                                                                                                                         |
| `handle`     | `(ref, body, { entity?, workflow, firstRunId?, credentials, client }) => Promise<JsonValue \| void>`; `ref` names the opened run and `firstRunId` (also `workflow.firstRunId`) is the execution chain ID when Temporal reports it, letting the action choose whether to target the run or the chain; the returned value is sent back as `{ result }` |

The extension point is registered even when `temporal.control.enabled` is
false, so modules still start; their actions are then ignored with a
warning. An invalid `id` also fails startup, whether operations are
enabled or not. The `client` carries the backend's connection: it reaches every
workflow of the namespace, and any other namespace the credentials of that
connection can reach: an action that touches other workflows must
check them itself with `temporalAccessServiceRef`.

Errors that `handle` throws are answered like those of the built-in
operations: an error of `@backstage/errors` with its own status;
`WorkflowNotFoundError` of the Temporal client as `404`,
`WorkflowUpdateFailedError` as `400`,
`WorkflowUpdateRPCTimeoutOrCancelledError` as `503`; a gRPC error by its
code (`NOT_FOUND` `404`, `INVALID_ARGUMENT` `400`, `ALREADY_EXISTS` and
`FAILED_PRECONDITION` `409`, `UNAVAILABLE` and `DEADLINE_EXCEEDED` `503`);
anything else `500`. The message of an error from Temporal or the client is
fixed text, not what Temporal said (see [HTTP API](#http-api)),
with one exception: the message of the failure that a rejected update
carries (`400`). A client that cannot connect answers `503`. Every call
of `client` shares one deadline of 60 seconds for the whole action. An
action that needs longer wraps its calls in
`client.connection.withDeadline(deadline, fn)`: the deadline given there
replaces the 60 seconds for the calls made inside `fn`.

### Feature loader and catalog module

`backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))` adds
three features: `temporalPlugin`, `temporalAccessServiceFactory` and
`catalogModuleTemporalWorkflowKind`. The catalog module is a module of the
`catalog` plugin; in a backend without the catalog it is skipped, and a split
deployment adds it to the backend that runs the catalog. Without it the
catalog rejects `TemporalWorkflow` entities.

## Frontend extension

![Where frontend extensions appear. On the right, the pages of the entity tab and of the Temporal page: above a workflow list the list actions (Start workflow, then yours), on each schedule the schedule actions, on the details page of a run the actions in the action bar (Signal, Cancel and the other operations, then yours, before Query and Refresh) and the sections as tabs after Steps, Timeline, Events and Details. On the left, the new frontend system: the five blueprints attach to the inputs actions, sections, listActions and scheduleActions of api:temporal/workflow-extensions, which is not exported; the legacy system: the props workflowActions, workflowSections, workflowListActions and scheduleActions of EntityTemporalContent and TemporalPage, and createTemporalControlActionDef. Both meet at the same places, props first, one entry per id. Components get TemporalWorkflowExtensionProps and call the backend with temporalApiRef (api:temporal, TemporalClient).](images/frontend-mounts.svg)

### Blueprints and props

Both frontend systems fill the same four places on the same pages (the
entity tab and the Temporal page). The page takes the legacy props first,
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
`permission?`) plus `filter?`. With `permission` the
button is disabled for users who lack it.

### `TemporalWorkflowExtensionProps`

What actions and sections receive as props. To test a component, render it
with these props:

| Field               | Is                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `workflow`          | The `WorkflowDetail` shown                                                                                                |
| `entity?`           | The catalog entity the page is shown for; absent on the Temporal page                                                     |
| `reload()`          | Reads the workflow again, for example after your button changed it                                                        |
| `workflowHref(ref)` | The link of another run's details page on the same page (entity tab or Temporal page), for example a run you just started |

List actions get `{ entity?, workflowHref(ref) }`; schedule actions get
`{ schedule, entity?, reload() }`.

### `temporalApiRef`

`temporalApiRef` (`plugin.temporal.api`) and its interface `TemporalApi` are
the client of the [HTTP API](#http-api): reads (`listEntityWorkflows`,
`listWorkflows`, `listWorkflowRuns`, `getWorkflow`, `getWorkflowGraph`, …)
and operations (`startWorkflow`, `signalWorkflow`, `runWorkflowAction`, …).
The methods on one run take a `WorkflowRunRef` (with its run ID) and the
`entityRef` the workflow is shown for, on which the backend checks the
permission; `listWorkflowRuns` lists the runs of a workflow ID. Your extensions and other plugins call it with `useApi`;
the plugin provides `TemporalClient` as the default (extension
`api:temporal` in the new system, `temporalPlugin` in the legacy one).
New methods come with the backend routes they call, in minor versions; that
is not a breaking change. To replace the client, extend `TemporalClient` and
override what you change, so that the new methods keep working.

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
| `page:temporal`                                | Temporal page on `/temporal`                                          |
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

The plugin has two route refs: `root` (the Temporal page, `temporal:root`)
and `entityContent` (the entity tab, `temporal:entity-content`). In the
legacy system they are `temporalPlugin.routes.root` and
`temporalPlugin.routes.entityContent` of the main entry point; in the new
system the default export of `./alpha` has the same `routes`. Another plugin
links to the Temporal page with `useRouteRef(temporalPlugin.routes.root)`.

Below either page, the details of a run are at
`namespaces/:namespace/workflows/:workflowId/runs/:runId`: for the
Temporal page on `/temporal` that is
`/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId`, which
`buildWorkflowRunPath` of `./common` builds after the page path. The
`workflowUrl` output of the Scaffolder module (and of the actions registry
module) uses this shape, under `temporal.pagePath` (default `/temporal`);
`buildWorkflowUrl` of `./node` builds it. Without the
run, `namespaces/:namespace/workflows/:workflowId` (`buildWorkflowPath`)
lists the runs of the workflow ID; with only one run, it opens that run.

## HTTP API

Every route is under the backend plugin's base URL, `/api/temporal`, and
needs Backstage credentials: a user token, or a token of another backend
plugin on behalf of a user.

The contract of the HTTP API is the OpenAPI spec
[`plugins/temporal-backend/src/schema/openapi.yaml`](../plugins/temporal-backend/src/schema/openapi.yaml),
published with the backend package: every parameter, body and response,
and the permissions of each route. The route tests check responses against
it (and requests that do not get a 400). A reconciliation test checks the
spec and the program both ways. CI validates the spec
(`yarn lint:openapi`); see
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

`:wf` stands for `namespaces/:namespace/workflows/:workflowId/runs/:runId`,
one run. Every route under `:wf`, the run list of a workflow ID and the
schedule operations take `?entityRef=`, the entity the workflow is shown
for.

#### Which entity a workflow is checked on

- With `entityRef`: the read permission (`temporal.workflow.read`) on that
  entity, and the workflow must be one of its workflows (`404` otherwise). When a workflow
  matches through a `TemporalWorkflow` entity that the opened entity depends on
  (directly, or via an ancestor for a child workflow), permissions check both
  entities: both the opened entity and the matched `TemporalWorkflow` entity must
  allow `temporal.workflow.read` and any operation permission. When the opened
  entity's own annotations or search attribute match the workflow, only the
  opened entity is checked.
- Without it: first the list permission on the workflow itself
  (`temporal.workflow.list`), with its conditions. If it does not allow it,
  the entity in the workflow's `searchAttributes.entityRef` attribute is
  checked as above. A caller whom neither the list permission nor the read
  permission on entities can allow gets `403` before the workflow is read.
  For the others, unless the list permission allows every workflow, a
  workflow they may not open (without that attribute, or through an entity
  they may not read) gets the same `404` as a workflow that does not exist.
- An operation then checks its own permission on the entity it was read
  through (and on the matched `TemporalWorkflow` entity when matched through
  one). A workflow that the list permission allowed is read through no
  entity: the operation then uses the entity of its search attribute only
  when the workflow opens with it as with `entityRef` (the caller may read
  the entity, and the workflow is in its namespace and one of its
  workflows), and checks the matched `TemporalWorkflow` entity too. Anyone
  who starts a workflow can set that attribute, so an entity that does not
  pass, does not exist or cannot be read counts as none. A workflow without
  an entity needs the permission allowed without conditions.

Errors are Backstage error bodies: `400` input, `401` no valid
credentials, `403` denied, `404` not found, `409` a conflict (`signal` on a
run that is not running, with `continuedAsNewRunId` in the error when it
continued as new; `update` or `terminate` when the execution chain
has ended or the workflow ID now belongs to a different chain (`cancel` on an
ended chain answers `202`: Temporal does nothing; when the Temporal server does
not report the chain ID, these operations act on the opened run only); a rerun of a
run that is still running; the action's filter refused it, or Temporal
refused it: a workflow ID already in use, a schedule in the wrong state), `503` Temporal
not reachable, not answering within the deadline of the call, rate limiting
the backend, refusing the backend's own credentials, or no worker answering
a query or an update in time.

**Messages of errors.** The message of an error that comes from Temporal or its client is fixed text.
What Temporal said (an address, a visibility query, a detail of the server)
is written to the backend log, with the name of the call, the namespace and
the gRPC status, and never sent to the browser. In production, a route never
answers with a stack trace or the message of an unexpected error either.

| Status | Message                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `404`  | `Not found in Temporal` for what Temporal does not have. The routes that look up a workflow or an entity name the ID or reference the caller gave                                                                                                |
| `400`  | `Temporal rejected the request as invalid`, or `The workflow failed the query` when a query handler fails or no handler has the name. Messages about the caller's own input (a wrong parameter, a namespace that is not allowed) name that input |
| `409`  | `The resource already exists in Temporal`, `The resource is not in a state that allows this`, `The workflow rejected the query`                                                                                                                  |
| `503`  | `Temporal is not reachable`, `Temporal did not answer in time`, `Temporal is rate limiting the backend`, `Temporal refused the credentials of the backend`, `No worker answered in time`, `The update did not finish in time`                    |
| `500`  | `Internal server error`                                                                                                                                                                                                                          |

The one message of a worker that the API returns is the failure of an update
that the workflow rejected (`400`): the workflow's own code wrote it for the
caller. The `error.message` of a workflow type overview item is one of
`Temporal is rate limiting the backend` (with `rateLimited: true`),
`Temporal did not answer in time` or `The numbers could not be read`.

Routes the backend does not serve answer `404` **without** a body: the
operations when `temporal.control.enabled` is false, and the definition route
without the Zigflow backend module. The two list routes take
`searchAttribute`, the name of a `Bool` search attribute that must be true.

Reads are always served:

| Method and path                                    | Permission                                                                                                                                                                    | Request                                                                                                          | Response                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /entities/:kind/:namespace/:name/workflows`   | `temporal.workflow.read` (entity)                                                                                                                                             | `status`, `allRuns`, `searchAttribute`, `pageSize`, `pageToken`                                                  | `WorkflowListResponse`               |
| `POST /workflow-types/overview`                    | `temporal.workflow.read` on each entity, in one request; the entities the caller may not read are left out (no `403`)                                                         | `WorkflowTypeOverviewRequest` (1 to 25 `TemporalWorkflow` references)                                            | `WorkflowTypeOverviewResponse`       |
| `GET /entities/:kind/:namespace/:name/schedules`   | `temporal.workflow.read` (entity)                                                                                                                                             |                                                                                                                  | `TemporalScheduleListResponse`       |
| `GET /workflows`                                   | `temporal.workflow.list` (conditions become a query)                                                                                                                          | `namespace`, `status`, `allRuns`, `workflowType`, `workflowIdPrefix`, `searchAttribute`, `pageSize`, `pageToken` | `WorkflowListResponse`               |
| `GET /schedules`                                   | `temporal.workflow.list`, unconditional                                                                                                                                       | `namespace`                                                                                                      | `TemporalScheduleListResponse`       |
| `GET /namespaces/:namespace/workflows/:workflowId` | with `entityRef`, `temporal.workflow.read` on it (only its runs; the entity must be in the namespace of the path); else `temporal.workflow.list`, its conditions on every run | `entityRef`, `pageSize`, `pageToken`                                                                             | `WorkflowListResponse`               |
| `GET /:wf`                                         | read                                                                                                                                                                          | `entityRef`                                                                                                      | `WorkflowDetail`                     |
| `GET /:wf/graph`                                   | read (inputs, results, step summaries, event group labels and whole failures)                                                                                                 | `entityRef`                                                                                                      | `WorkflowGraphResponse`              |
| `GET /:wf/progress`                                | read                                                                                                                                                                          | `entityRef`                                                                                                      | `WorkflowProgressResponse`           |
| `GET /:wf/message-definitions`                     | read                                                                                                                                                                          | `entityRef`                                                                                                      | `WorkflowMessageDefinitionsResponse` |
| `GET /:wf/history`                                 | read                                                                                                                                                                          | `entityRef`, `pageSize`, `pageToken`                                                                             | `WorkflowHistoryResponse`            |
| `GET /:wf/result`                                  | read                                                                                                                                                                          | `entityRef`                                                                                                      | `WorkflowResultResponse`             |
| `POST /:wf/query`                                  | read and `temporal.workflow.query`; audited                                                                                                                                   | `WorkflowMessageRequest`                                                                                         | `WorkflowMessageResponse`            |
| `GET /:wf/llm-calls/:eventId`                      | read. **Experimental**                                                                                                                                                        | `entityRef`, `index`                                                                                             | `WorkflowLlmCallResponse`            |

`POST /workflow-types/overview` takes `refresh: true` to read the numbers again instead of using the ones kept for 60 seconds; the reads still wait for the rate limit of the overview. The statistics card of a `TemporalWorkflow` entity uses this route, so it shows the same numbers as the Workflows tab of the Temporal page.

"read" is decided as in
[Which entity a workflow is checked on](#which-entity-a-workflow-is-checked-on).

Failures are whole `WorkflowFailure`s, with `source`, `stackTrace`,
`nonRetryable` and the `cause` chain: `WorkflowDetail.failure` and the
`lastFailure` of its pending activities (`GET /:wf`), the `failure` of the
graph nodes and their attempts (`GET /:wf/graph`), `GET /:wf/result` and the
model call records (`GET /:wf/llm-calls/:eventId`). The `current` text of the
graph and of `GET /:wf/progress` uses the outermost message only, and
`WorkflowLlmSummary.error` is the error type of the model call, or `error`
when the record has none. The lists have no failures. The routes that change
a workflow answer an update the workflow rejects with the messages of the
rejection and its causes (`400`), like the result of an update that
succeeds. The message is the one the SDK recorded; some SDKs build it from
the causes.

On `WorkflowGraphResponse` and `WorkflowProgressResponse`, `totalSteps` is the
number of steps seen so far in the history events read (not a total for a
running workflow, because later steps are unknown until they run). When
`truncated` is true, the history exceeded the backend event limit (5,000 events
for `/graph` and 1,000 events for `/progress`), so counts cover only the first
events read. `GET /:wf/llm-calls/:eventId` uses the same 5,000-event limit and
answers `404` explaining that the history was truncated when `eventId` lies
beyond the events read. Neither endpoint caches histories: every request reads
them again. To bound the load, set a rate limit for the Temporal plugin only
(`backend.rateLimit.global: false` and `backend.rateLimit.plugin.temporal` with
`window` and `incomingRequestLimit`; see the [README](../README.md)). Do not set
`backend.rateLimit: true`: it limits the whole backend, by default to 5
requests per minute for each IP address. The limit counts the requests of one
IP address in the window and applies to every route of the plugin.

The run list of a workflow ID has the runs that continued as new. Its order
is the one of Temporal's visibility store: the plugin asks for none (SQL
visibility refuses `ORDER BY`; it lists the running run first, then the
closed runs, the last closed first). Runs past the retention period of the
namespace are not listed. With `entityRef`, child workflows of the entity's
workflows are not listed, though their runs open with that entity. A
workflow ID with a quote, a backslash or a control character cannot be
listed (`400`): open its run by its run ID.

Operations are served unless `temporal.control.enabled` is false; then the
routes do not exist and answer `404` without an error body. Each one is
recorded with the auditor ([event IDs](#what-the-plugin-writes)):

| Method and path                                                               | Permission                                                                                                                                                                                     | Request                                           | Response                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `POST /entities/:kind/:namespace/:name/workflows`                             | `temporal.workflow.start` on the entity (read is not checked); only its workflow types and task queue                                                                                          | `WorkflowStartRequest`                            | `201` `WorkflowStartResponse`                    |
| `POST /workflows`                                                             | `temporal.workflow.list` and `temporal.workflow.start`, both without conditions (read is not checked)                                                                                          | `WorkflowStartRequest`                            | `201` `WorkflowStartResponse`                    |
| `POST /:wf/signal`                                                            | read and `temporal.workflow.signal`; opened run only (must be running)                                                                                                                         | `WorkflowMessageRequest`                          | `202` `{}`                                       |
| `POST /:wf/update`                                                            | read and `temporal.workflow.update`; execution chain (`firstExecutionRunId`, without `runId`)                                                                                                  | `WorkflowUpdateRequest`                           | `WorkflowMessageResponse`                        |
| `POST /:wf/cancel`                                                            | read and `temporal.workflow.cancel`; execution chain (`firstExecutionRunId`, without `runId`)                                                                                                  |                                                   | `202` `{}`                                       |
| `POST /:wf/terminate`                                                         | read and `temporal.workflow.terminate`; execution chain (`firstExecutionRunId`, without `runId`)                                                                                               | `{ reason? }`                                     | `{}`                                             |
| `POST /:wf/rerun`                                                             | read and `temporal.workflow.rerun`; closed runs only                                                                                                                                           | `{ workflowId? }`                                 | `201` `WorkflowStartResponse`                    |
| `POST /:wf/actions/:actionId`                                                 | read, then the action's `permission`, then its `filter`; an unknown `actionId` answers `404` and is recorded as a failed `workflow-action` event                                               | any JSON                                          | `WorkflowMessageResponse` (`{ result }` or `{}`) |
| `POST /namespaces/:namespace/schedules/:scheduleId/(pause\|unpause\|trigger)` | `temporal.workflow.start` on `?entityRef=` (the schedule must start its workflows), else `temporal.workflow.list` and `temporal.workflow.start`, both without conditions (read is not checked) | `TemporalScheduleNoteRequest` (not for `trigger`) | `202` `{}`                                       |

The Zigflow backend module adds
`GET /entities/:kind/:namespace/:name/definition` (`temporal.workflow.read`
on a `TemporalWorkflow` entity with `spec.definition`). These 25 routes
(15 reads, 9 operations, 1 of the Zigflow module) are the plugin's own.
Because the plugin uses the permissions registry (its permissions and the
`temporal-workflow` resource type), the backend also mounts the permission
framework's `GET /.well-known/backstage/permissions/metadata` and
`POST /.well-known/backstage/permissions/apply-conditions` under
`/api/temporal`; the permission backend calls them, not your code. The
plugin applies the conditions of `temporal-workflow` itself, so it loads no
workflows for `apply-conditions`: a request for that resource type answers
`501`.

The path helpers of `./common` (`buildWorkflowPath`, `buildWorkflowRunPath`,
`buildEntityWorkflowsPath`, `buildWorkflowOperationPath`,
`buildWorkflowActionPath`, …) build these paths; prefer them to writing
paths by hand. From the browser, use `temporalApiRef` instead.

### One custom action, from the button to Temporal

![One custom action in nine steps. In the browser: (1) the button of TemporalControlActionBlueprint, with your params label, confirm, body, permission (disables the button) and filter (shows it); (2) TemporalApi.runWorkflowAction(); (3) POST /api/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId/actions/:actionId. In the backend: (4) the route exists only when temporal.control.enabled is true, and the actionId must be registered, else 404; (5) loadWorkflow() checks the namespace and the read level on the entity; (6) authorizeOn() checks the action’s permission, else 403; (7) the action’s filter, else 409; (8) the auditor records workflow-action; (9) action.handle() runs with the entity, workflow, credentials and Temporal client and calls Temporal. Its value comes back as { result } and the button shows it. Your code runs at steps 1, 7 and 9.](images/action-flow.svg)

The same order holds for the built-in operations, with their own
permission and without your code. For `update`, `cancel` and `terminate`,
permissions and `entityRef` membership are checked on the opened run, while
Temporal executes the operation on whichever run is currently running in the
same execution chain (`firstExecutionRunId` without `runId`, which prevents
affecting any later chain that reused the workflow ID). The plugin assumes
all runs in an execution chain belong to the same catalog entity: workflow
IDs do not change across a chain and Temporal preserves search attributes
when `continueAsNew` omits them, but workflow code can still switch workflow
type, task queue or search attributes on Continue-As-New, so environments
that match entities or permission conditions on those fields should account
for that. A Query runs the same way under the read routes, so it stays
when the operations are off.

## Permissions

The plugin registers 9 permissions (`temporalPermissions` in `./common`;
`temporalControlPermissions` are the six that change workflows). Write
policies with these objects or names; the [README](../README.md#permissions)
explains each one and has policy examples.

| Permission                    | Export                                | Resource type       | Turned off with the operations |
| ----------------------------- | ------------------------------------- | ------------------- | ------------------------------ |
| `temporal.workflow.read`      | `temporalWorkflowReadPermission`      | `catalog-entity`    |                                |
| `temporal.workflow.list`      | `temporalWorkflowListPermission`      | `temporal-workflow` |                                |
| `temporal.workflow.query`     | `temporalWorkflowQueryPermission`     | `catalog-entity`    |                                |
| `temporal.workflow.start`     | `temporalWorkflowStartPermission`     | `catalog-entity`    | yes (also schedules)           |
| `temporal.workflow.signal`    | `temporalWorkflowSignalPermission`    | `catalog-entity`    | yes                            |
| `temporal.workflow.update`    | `temporalWorkflowUpdatePermission`    | `catalog-entity`    | yes                            |
| `temporal.workflow.cancel`    | `temporalWorkflowCancelPermission`    | `catalog-entity`    | yes                            |
| `temporal.workflow.terminate` | `temporalWorkflowTerminatePermission` | `catalog-entity`    | yes                            |
| `temporal.workflow.rerun`     | `temporalWorkflowRerunPermission`     | `catalog-entity`    | yes                            |

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
`TemporalWorkflowFilter` (a visibility query, or `{ namespaces }` or
`{ initiators }`). A string returned by `toQuery` is placed directly into the
Temporal visibility query — always build it with `inCondition` and `quote`
exported from `./alpha` instead of concatenating raw values (the plugin
rejects empty strings, unclosed quotes, comments and unbalanced parentheses). The permission of a
custom action is a `catalog-entity` permission, usually one of these.

In the plugin's code, a standalone "query" is a Temporal Query (the
operation that runs a query handler on a worker). Conditions used to search
or list workflows are a visibility query or a filter, for example
`TemporalWorkflowFilter` and `buildEntityVisibilityQuery`. Two exceptions:
URL query parameters (`req.query`, `queryString`) keep that name because it
is the usual term of the framework, and a permission rule's `toQuery` keeps
the name required by the Backstage permission framework.

## Configuration keys

All keys are under `temporal`. The schemas are the `config.d.ts` of four
packages: [`temporal-backend`](../plugins/temporal-backend/config.d.ts) (core
keys below), [`temporal`](../plugins/temporal/config.d.ts)
(the keys the browser sees),
[`temporal-backend-module-zigflow`](../plugins/temporal-backend-module-zigflow/config.d.ts)
(`definitions.*`) and
[`temporal-backend-module-actions`](../plugins/temporal-backend-module-actions/config.d.ts)
(`actions.allowServiceWrites`).
Defaults and meanings are in the [README](../README.md#configuration).

| Key                                                                                                                             | Read by                                                             | Visible in the browser |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `connection.address`                                                                                                            | backend (`temporalServiceRef`)                                      |                        |
| `connection.namespaces`, `connection.tls`, `connection.auth.type`                                                               | backend                                                             |                        |
| `connection.auth.token`                                                                                                         | backend; secret                                                     |                        |
| `connection.defaultNamespace`                                                                                                   | backend, frontend, Scaffolder backend module                        | yes                    |
| `webUi.baseUrl`                                                                                                                 | backend, frontend                                                   | yes                    |
| `searchAttributes.entityRef`, `searchAttributes.initiator`                                                                      | backend                                                             |                        |
| `control.enabled`                                                                                                               | backend (mounts the operation routes), frontend (shows the buttons) | yes                    |
| `control.allowedSignals`, `control.allowedUpdates`                                                                              | backend (rejects), frontend (offers)                                | yes                    |
| `externalStorage.objectUrl`                                                                                                     | frontend                                                            | yes                    |
| `overview.maxVisibilityCallsPerSecond`                                                                                          | backend (per process, default `5` calls/s per namespace)            |                        |
| `definitions.allow`, `definitions.maxBytes`, `definitions.readFileLocations`                                                    | Zigflow backend module                                              |                        |
| `definitions.cacheTtlSeconds`, `definitions.cacheMaxEntries`, `definitions.maxConcurrentReads`, `definitions.maxReadsPerMinute` | Zigflow backend module (per process: URL read cache and limits)     |                        |
| `actions.allowServiceWrites`                                                                                                    | Actions registry backend module                                     |                        |
| `pagePath`                                                                                                                      | Scaffolder and actions registry backend modules (`workflowUrl`)     |                        |

The Scaffolder and actions registry backend modules also read Backstage's
own `app.baseUrl`, for the `workflowUrl` output.

## Catalog: annotations and the `TemporalWorkflow` kind

Annotations on any entity (constants in `./common`):

| Annotation                  | Constant                            | Value                           |
| --------------------------- | ----------------------------------- | ------------------------------- |
| `temporal.io/namespace`     | `TEMPORAL_NAMESPACE_ANNOTATION`     | Namespace                       |
| `temporal.io/task-queue`    | `TEMPORAL_TASK_QUEUE_ANNOTATION`    | Task queue                      |
| `temporal.io/workflow-type` | `TEMPORAL_WORKFLOW_TYPE_ANNOTATION` | Workflow types, comma separated |

The kind: `apiVersion: temporal.io/v1alpha1`, `kind: TemporalWorkflow`
(`TemporalWorkflowEntityV1alpha1`; the catalog module validates it with
its JSON schema), one entity per workflow type.

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
| `definition`   |          | `format` (`serverless-workflow`), `target` (Definition tab)                                   |

Other entities link to a workflow entity with the standard `spec.dependsOn`
(`temporalworkflow:default/order-workflow`). These mappings (annotations, `spec`,
and `spec.dependsOn`) are declared by catalog entity authors; restrict catalog
write/registration access to control who defines them. The
[README](../README.md#workflow-entities) has the details and examples;
[How workflows map to the catalog](catalog-model.md) explains the design.

## What the plugin writes

Other systems can read these, so they are interfaces too:

- **Search attributes.** Workflows started or rerun from Backstage (pages,
  API, Scaffolder) get the entity reference in
  `temporal.searchAttributes.entityRef` (start from an entity) and the user
  in `temporal.searchAttributes.initiator`, when those keys are set. Both
  must be `Keyword` attributes registered in Temporal. A rerun keeps the
  original run's attributes, except the ones Temporal sets itself (names
  starting with `Temporal`), and sets the initiator.

  The plugin reads both attributes on **every** workflow, whoever set them:
  the entity reference adds the workflow to that entity's list and decides
  on which entity its permissions are checked, and the initiator is what the
  `IS_INITIATOR` rule compares. Trust in both attributes matches trust in
  whoever can start workflows or write search attributes in the configured
  Temporal namespaces, so restrict namespace write access or omit these keys if
  external writers must not influence entity matching or `IS_INITIATOR`.

- **Identity.** Operations pass `backstage:<user entity ref>` (or
  `backstage:<service subject>`) as the Temporal identity, shown in the
  history.
- **Audit events** (auditor service, plugin `temporal`): `workflow-start`,
  `workflow-signal`, `workflow-update`, `workflow-query`, `workflow-cancel`,
  `workflow-terminate`, `workflow-rerun`, `workflow-action`,
  `schedule-pause`, `schedule-unpause`, `schedule-trigger`, with the
  namespace, workflow and entity in the metadata; `workflow-update`,
  `workflow-cancel` and `workflow-terminate` also include `firstRunId` and
  `scope: 'chain'` (`scope: 'run'` without `firstRunId` when the Temporal server
  does not report the chain ID). Their severity is
  `medium`, except `workflow-terminate`, which is `high` because a
  terminate cannot be undone. An event is created before the permission and the request are checked, so a refused or invalid attempt is recorded too, as a failure with the target of the request (namespace, workflow, run, `entityRef`). URL values that fail format validation or exceed the length limit are recorded as the placeholder `'<invalid>'` instead of the raw value.

  Backstage's default mapping sends `low` to `debug`, and `medium`, `high`
  and `critical` to `info`. The backend logs `info` and above by default, so
  a `low` event does not appear. To show `low` events, either set
  `backend.auditor.severityLogLevelMappings.low` to `info` (this is global:
  it also turns on the catalog's read events) or raise only this plugin's
  audit events with a logger override:

  ```yaml
  backend:
    logger:
      overrides:
        - matchers:
            plugin: temporal
            isAuditEvent: true
          level: debug
  ```

- **Logs** (logger service, plugin `temporal`). Messages are fixed
  strings; what varies is in fields, so a log can be filtered by field
  (`logger.child({ ... }).warn('Fixed message')`), also for a workflow ID,
  which is free text. The fields are:
  `namespace`, `workflowId`, `runId`, `firstRunId`, `workflowType`, `taskQueue`,
  `entityRef`, `scheduleId` (the names the audit events use), and
  `temporalCall` (the category of a call to Temporal, such as
  `describeWorkflowExecution` or `schedule.list`), `grpcCode`, `grpcStatus`,
  `durationMs`, `timeoutMs`, `permission`, `updateId`, `messageName`
  (the name of a signal, update or query) and `errorName`. They avoid the
  names Backstage's logger already uses (`plugin`, `service`, `type`,
  `status`, `level`, `message`, `stack`).

  Every call to Temporal is logged at `debug` with its category, namespace
  and duration. A failed call is logged with the gRPC status: at `warn`
  when the server or the backend's own credentials are at fault
  (`UNAVAILABLE`, `RESOURCE_EXHAUSTED`, `PERMISSION_DENIED`,
  `UNAUTHENTICATED`, `INTERNAL`, `UNKNOWN`, `UNIMPLEMENTED`, and a missed
  deadline of any call but a query), at `debug` when the request is (`NOT_FOUND`,
  `INVALID_ARGUMENT`, `ALREADY_EXISTS`, `FAILED_PRECONDITION`, a schedule or
  namespace that does not exist, a query that no worker answers). Other
  `warn` entries: a permission condition the plugin cannot apply (a policy
  problem, which callers see only as a refusal), a `TemporalWorkflow` entity
  whose spec is not valid, a connection that cannot be opened, an update
  that did not finish within the polls, a failing definition file.

  Never logged: payloads, the arguments and results of signals, updates and
  queries, tokens, and request or response bodies. Fields hold IDs, names,
  status codes and durations.

The plugin shows a workflow's memo on the details page. It also reads the
references of Temporal External Storage, written by the SDK's S3 driver in
its own format, to show where a stored payload is (the plugin does not read
the stored data). When setting `externalStorage.objectUrl`, keep `{bucket}` in
the path or as a subdomain under a fixed trusted domain rather than using
`{bucket}` as the entire host, so a workflow history value cannot direct links
to arbitrary HTTPS hosts. On a domain shared by many tenants
(`*.s3.amazonaws.com`, `*.blob.core.windows.net`, `storage.googleapis.com`),
write your own bucket into the template instead of `{bucket}`, since any
tenant's bucket is on that domain. A bucket or key that makes a `.` or `..`
path segment gives no link. The details page shows a memo entry as a stored
payload only when it has exactly the form the backend writes for a
reference.

## Scaffolder

`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal` adds
four template actions. They call the HTTP API of the plugin as the user who
runs the template (they may run in another backend than the plugin):

| Action                     | Input                                                                                                                                               | Output                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `temporal:workflow:start`  | `entityRef`, or `workflowType` and `taskQueue`; `namespace`, `workflowId`, `args`                                                                   | `namespace`, `workflowId`, `runId`, `workflowUrl` |
| `temporal:workflow:wait`   | `workflowId`, `runId`, `namespace`, `entityRef`; `untilSearchAttribute`, `timeoutSeconds`, `intervalSeconds`, `failIfNotCompleted`, `includeResult` | `status`, `runId`, `result`, `searchAttributes`   |
| `temporal:workflow:signal` | `workflowId`, `runId`, `namespace`, `entityRef`; `name`, `args`                                                                                     | `runId`                                           |
| `temporal:workflow:update` | `workflowId`, `runId`, `namespace`, `entityRef`; `name`, `args`                                                                                     | `result`, `runId`                                 |

`start`, `signal` and `update` need the operations; `wait` only reads (the workflow,
and `/result` for its result). Because `wait` writes `searchAttributes` and
(when `includeResult: true`) `result` to Scaffolder task outputs, visibility
of those persisted outputs is governed by Scaffolder task permissions rather than
`temporal.workflow.read`. Without `runId`, `wait`, `signal` and `update` look up
the latest run in the run list of the workflow ID (which can lag behind a
start; pass `runId: ${{ steps.start.output.runId }}` after a start). `wait`
follows a run that continued as new to the run it continued as; `signal`
outputs the run it sent to, and sends once more to the run it continued as
when the run it looked up continued as new in the meantime.
`@kwkevinchan/backstage-plugin-scaffolder-module-temporal` adds the form
field `TemporalWorkflowPicker`, whose value is a workflow ID; its
`ui:options` are `TemporalWorkflowPickerUiOptions` (`entityRef`,
`workflowType`, `namespace`, `status`, `searchAttribute`). The action
schemas are shown on the Scaffolder's actions page; see the
[module README](../plugins/scaffolder-backend-module-temporal/README.md).
After `temporal:workflow:wait` returns, a later official `notification:send`
step can notify someone and set `link` to `steps.start.output.workflowUrl`.
The limits of that pattern, a long-approval alternative, and a complete
template are in
[Notify when a decision is needed](../plugins/scaffolder-backend-module-temporal/README.md#notify-when-a-decision-is-needed)
and
[`examples/templates/release-with-notification.yaml`](../examples/templates/release-with-notification.yaml).

## Actions registry

`@kwkevinchan/backstage-plugin-temporal-backend-module-actions` registers five
actions in the Backstage actions registry: `temporal:list-workflows`,
`temporal:get-workflow`, `temporal:start-workflow`, `temporal:signal-workflow`
and `temporal:update-workflow`. An AI assistant or an MCP client (through
`@backstage/plugin-mcp-actions-backend`) calls them as the caller (a signed-in
user, or a service when it authenticates as one), over the same HTTP routes as
the pages and the Scaffolder actions, so user permission checks and audit
records are the same. For a service caller (such as a static token in
`backend.auth.externalAccess`), `auth.getPluginRequestToken` exchanges the
credentials for `plugin:temporal` (seen by the Temporal backend in the request
principal, audit `actorId` and `initiator` search attribute); permission policies
do not apply to service principals, and `externalAccess` tokens with
`permission` or `permissionAttribute` restrictions fail token delegation on all
actions (while `plugin: temporal` passes delegation). By default, service
callers are rejected with `NotAllowedError` on the three workflow-changing actions
(`start-workflow`, `signal-workflow`, `update-workflow`) unless
`temporal.actions.allowServiceWrites` is set to `true`, while `list-workflows`
and `get-workflow` remain available. To check each person, the
MCP client uses the token of that user. Workflow types, step names, failure
messages and search attributes returned by `list-workflows` and `get-workflow`
are untrusted data (not instructions); `list-workflows` and `get-workflow` are
`readOnly`, while the other three are `destructive` so clients should ask a
person first (or exclude `{ destructive: true }` via
`backend.actions.filter.exclude` when writes are not needed). Cancel, terminate
and rerun are not actions. The actions, their attributes and the MCP config are
in the [module README](../plugins/temporal-backend-module-actions/README.md).

## Zigflow

`temporal-backend-module-zigflow` serves the definition file of a
`TemporalWorkflow` entity (route above, keys `definitions.*`);
`temporal-module-zigflow` shows it on a **Definition** tab
(`EntityTemporalDefinitionContent` in the legacy system, mount it on
`/definition` of the workflow entity page;
`entity-content:temporal/definition` in the new one). Always configure `paths`
under `temporal.definitions.allow` on hosts with a Backstage integration so
entity authors cannot reach arbitrary repositories readable by that integration;
the route reads only `.yaml` and `.yml` files and returns their text only when they are valid definitions (a file with a parse error is answered without its content), `file:` targets must
be regular files in the folder of the entity file after symlinks are
resolved, and HTTP redirects follow
Backstage's `UrlReader` rules rather than re-checking `temporal.definitions.allow`.
The response of the
route (`WorkflowDefinitionResponse`) is not exported: the two modules are
released together and the route is for the tab only.

## Experimental: model calls and event groups

> **Experimental. These will change substantially before the first
> release. Do not depend on them.**

- the model calls and tool calls: always on. The route
  `GET /:wf/llm-calls/:eventId`, the `TemporalApi` method `getLlmCall`
  (`@alpha`), the names of `llm.ts` in `./common`, the fields `llm` and
  `tool` of `WorkflowGraphNode`.
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
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal/alpha';
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
import { TemporalControlActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal/alpha';
import { temporalWorkflowUpdatePermission } from '@kwkevinchan/backstage-plugin-temporal/common';

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

### Add a tab to the details page

```tsx
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { Text } from '@backstage/ui';
import { TemporalWorkflowSectionBlueprint } from '@kwkevinchan/backstage-plugin-temporal/alpha';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal';

export function OwnerSection(props: TemporalWorkflowExtensionProps) {
  const owner = props.entity?.spec?.owner;
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
to `EntityTemporalContent` and `TemporalPage`. Pass the props on to a
component deeper in the tab. This tab reads the owner of the entity, so on
the Temporal page, which has no entity, it shows "unknown".

### Override an extension

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal/alpha';

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

The `workflowUrl` output of the Scaffolder actions and the actions registry
module points to `/temporal` by default. When the page is mounted elsewhere,
set `temporal.pagePath` (for example `/pipelines`) and both modules build the
link with that path.

`api:temporal` takes its params as a callback; give it your own
`TemporalApi` with
`params: defineParams => defineParams({ api: temporalApiRef, deps: {}, factory: () => myClient })`
([README](../README.md#extending)).

### Own `temporalServiceRef`

For example a connection with a client certificate. Extend
`DefaultTemporalService`, which reads the rest from the config as the
default factory does (`readTemporalServiceOptions`), and override
`getConnection` and `close`: its `getClient` makes the clients on
`this.getConnection()`, so the deadlines of the plugin apply to them. Add the
factory to the backend next to the plugin
(`backend.add(mtlsTemporalServiceFactory)`):

```ts
import { readFileSync } from 'node:fs';
import {
  coreServices,
  createServiceFactory,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Connection } from '@temporalio/client';
import {
  DefaultTemporalService,
  readTemporalServiceOptions,
  TemporalServiceOptions,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';

/** The built-in service, with a client certificate on its connection. */
class MtlsTemporalService extends DefaultTemporalService {
  readonly #address: string;
  #connection?: Promise<Connection>;

  constructor(options: TemporalServiceOptions, logger?: LoggerService) {
    super(options, logger);
    this.#address = options.address;
  }

  getConnection(): Promise<Connection> {
    this.#connection ??= Connection.connect({
      address: this.#address,
      tls: {
        clientCertPair: {
          crt: readFileSync('/etc/temporal/tls.crt'),
          key: readFileSync('/etc/temporal/tls.key'),
        },
      },
    }).catch(error => {
      // Connect again on the next call instead of keeping the failure.
      this.#connection = undefined;
      throw error;
    });
    return this.#connection;
  }

  async close(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    // Drops the clients made on the connection.
    await super.close();
    if (connection) await (await connection).close();
  }
}

export const mtlsTemporalServiceFactory = createServiceFactory({
  service: temporalServiceRef,
  deps: {
    config: coreServices.rootConfig,
    logger: coreServices.rootLogger,
    lifecycle: coreServices.rootLifecycle,
  },
  factory({ config, logger, lifecycle }) {
    const temporal = new MtlsTemporalService(
      readTemporalServiceOptions(config),
      logger,
    );
    lifecycle.addShutdownHook(() => temporal.close());
    return temporal;
  },
});
```

To implement `TemporalService` without the class, keep the rule of
[`temporalServiceRef`](#temporalserviceref): `getClient({ namespace })`
makes its client on `getConnection({ namespace })`.

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

| You look for                                                                 | Why it is not exported                                               | Use                                                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The JSON schema of the `TemporalWorkflow` kind, the name patterns            | Exporting them would make every new `spec` field a change of the API | The catalog module validates the kind; `isValidNamespaceName` and the other checks of `./common` |
| A resource reference of a workflow, to authorize from another plugin         | The plugin applies the conditions of `temporal-workflow` itself      | The HTTP API as the user ([example](#call-the-http-api-from-another-backend))                    |
| `DefaultTemporalAccessService`                                               | The checks are one contract through the interface                    | `temporalAccessServiceRef`, or your own factory for it                                           |
| The routers, `WorkflowQueries`, `WorkflowCommands`, the repositories         | Internal layers, wired by `plugin.ts`                                | The HTTP API, the extension points                                                               |
| `temporalWorkflowExtensionsApiRef`, `TemporalWorkflowExtensionsApi`          | The collection of blueprints is an implementation detail             | The blueprints; disable `api:temporal/workflow-extensions` to remove every extension             |
| The plugin's extensions by name (`temporalPage`, …)                          | Exported extensions would freeze their params                        | `getExtension(id)` and `withOverrides()` ([IDs](#extension-ids))                                 |
| The Zigflow types (`WorkflowDefinitionResponse`, …)                          | The route serves only the Definition tab                             | The Definition tab                                                                               |
| A frontend import of `@kwkevinchan/backstage-plugin-temporal-backend/common` | A frontend plugin must not import a backend plugin                   | `@kwkevinchan/backstage-plugin-temporal/common`, the same definitions                            |
| `./ui` components in your own plugin                                         | Made for the Zigflow module, `@alpha`                                | `@backstage/ui`                                                                                  |

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
it together with the routes; the route tests, the reconciliation test and
`yarn lint:openapi` check it. Update
this guide in the same pull request when the change adds, removes or
renames a name listed here.

Some reports carry warnings that API Extractor writes into them
(`// Warning: ...`), allowed for `temporal-backend` and `temporal`
(`--allow-warnings`); a new warning still shows up in the report diff. Most
are expected: a type of one entry point that names a type of another entry
point of the same package (for example `TemporalApi` and the response types
of `./common`), which this repository does not export twice. The others are
the experimental fields of the graph types (`@public` types that reference
`@alpha` ones), which change with the experimental views.

Back to [the documentation index](README.md).
