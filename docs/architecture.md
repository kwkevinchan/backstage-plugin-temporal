# Architecture

English | [繁體中文](zh-TW/architecture.md)

This guide answers: which packages make up the plugin and what does each layer
do, where can you extend it, and why is it built this way? It is the map to read
before you choose packages, write a backend module or a permission policy, or
contribute. For installation and configuration see the
[README](../README.md); for the contributor workflow see
[CONTRIBUTING.md](../CONTRIBUTING.md).

- [Packages](#packages)
- [The layers](#the-layers)
- [Extension points](#extension-points)
- [Design decisions](#design-decisions)

## Packages

![The packages in three layers: frontend packages in the Backstage app, backend packages in the Backstage backend, and two libraries: temporal-common, imported by both sides, and temporal-node, used only by backend packages. The workflow kit belongs to the workers, outside Backstage.](images/package-map.svg)

All names carry the prefix `@kwkevinchan/backstage-plugin-` (except the workflow
kit, `@kwkevinchan/temporal-workflow-kit`). Teal is the core, orange the control
modules that change workflows, purple other optional modules. The
[README](../README.md#packages) has the table with the role of each package and
[which ones to install](../README.md#packages).

- **Core** (`temporal` and `temporal-backend`): reads only. The frontend has the
  entity tab, the details page and the Workflows page; the backend serves
  `/api/temporal` and checks access. Query is part of the core.
- **Control** (`temporal-module-control` and `temporal-backend-module-control`):
  Start, Signal, Update, Cancel, Terminate, Rerun, schedule operations and custom
  actions. Without them the plugin cannot change anything.
- **Catalog** (`catalog-backend-module-temporal`): the `TemporalWorkflow` kind.
- **Scaffolder** (`scaffolder-backend-module-temporal`,
  `scaffolder-module-temporal`): template actions and the workflow picker field.
- **Zigflow** (`temporal-module-zigflow`, `temporal-backend-module-zigflow`): the
  Definition tab.
- **Libraries** (`temporal-common`, `temporal-node`): shared code, below.
- **`temporal-workflow-kit`**: for your Workers, not Backstage. Experimental,
  `private`, not published; it goes with the experimental AI views.
- **Development only** (never published): `packages/app`, `packages/app-next`,
  `packages/backend` and `packages/example-worker`.

### The two libraries

A Backstage frontend plugin cannot import a backend plugin, so everything that
both sides need lives in `temporal-common`: the API types, the permissions, the
URL paths, the annotation constants and the schema of the `TemporalWorkflow`
kind. Import it in your permission policies and modules.

`temporal-node` is for backend code that works with the plugin: `temporalServiceRef`
(the shared Temporal client), `temporalExtensionPoint` (workflow enrichers), and,
in `/alpha`, `temporalAccessServiceRef`, `temporalControlExtensionPoint` and the
`temporal-workflow` permission resource. Backend modules depend on it instead of
on `temporal-backend`, so the core's internals can change without breaking them.

## The layers

A request in `temporal-backend` goes down four folders in order
([Figure 1](how-it-works.md#figure-1-one-request-through-the-layers)). The table
and the classes are described in
[CONTRIBUTING.md](../CONTRIBUTING.md#backend-layout); in short:

| Layer           | Responsibility                                                                                                                                                  | In clean-architecture terms |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `routes/`       | Parse and validate the request, call access and services. No decisions.                                                                                         | Controllers                 |
| `access/`       | `DefaultTemporalAccessService`: permission checks and catalog lookups.                                                                                          | Authorization               |
| `services/`     | Four query classes (`EntityWorkflowSources`, `WorkflowListQueries`, `WorkflowQueries`, `AiWorkflowQueries`) and the conversion from Temporal data to API types. | Use cases                   |
| `repositories/` | `TemporalReadRepository` (Temporal calls) and `PayloadStore` (S3).                                                                                              | Gateways                    |

The model (the API types) is in `temporal-common`, and the shared client in
`temporal-node`. The classes are plain; `plugin.ts` creates and wires them, and
there is no repository interface and no dependency-injection container inside
the plugin. The control module has `routes/` and `services/` only:
`WorkflowCommands` calls Temporal directly.

The access service sits between routes and services but also uses the query
services (it has to read a workflow to decide who may see it). Among the query
services, `EntityWorkflowSources` is used by the other three, and `WorkflowQueries`
by `WorkflowListQueries` and `AiWorkflowQueries`; none depends on a class that
uses it.

On the frontend, `TemporalClient` (the default `temporalApiRef`) reads through the
backend; the control module adds `temporalControlApiRef` for operations. The
screens use `@backstage/ui`.

## Extension points

You can extend the plugin without changing it. The usage and examples are in
[Extending](../README.md#extending); this table lists what exists.

| You want to                                         | Use                                                                                                                                                                           | Where                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Add a button to the details page                    | `TemporalWorkflowActionBlueprint` (new frontend system) or `workflowActions` (legacy)                                                                                         | `temporal/alpha`                        |
| Add a tab to the details page                       | `TemporalWorkflowSectionBlueprint` or `workflowSections`                                                                                                                      | `temporal/alpha`                        |
| Add a control above the workflow lists              | `TemporalWorkflowListActionBlueprint` or `workflowListActions`                                                                                                                | `temporal/alpha`                        |
| Call the plugin from another plugin                 | `temporalApiRef`, `temporalControlApiRef`                                                                                                                                     | frontend                                |
| Add a backend action that changes a workflow        | `temporalControlExtensionPoint.addControlAction()`; served as `POST …/actions/:actionId` with the same access check, its permission, an optional `filter` and an audit record | `temporal-node/alpha`                   |
| Show a backend action as a button                   | `TemporalControlActionBlueprint` or `createTemporalControlActionDef()`                                                                                                        | `temporal-module-control`               |
| Add data to workflow summaries                      | `temporalExtensionPoint.addWorkflowEnricher()`                                                                                                                                | `temporal-node`                         |
| Reuse the plugin's access checks in your own routes | `temporalAccessServiceRef` (`loadWorkflow()`, `authorizeOn()`)                                                                                                                | `temporal-node/alpha`                   |
| Decide access in another way                        | Add your own factory for `temporalAccessServiceRef`; the default factory is then skipped                                                                                      | backend                                 |
| Add permission rules for workflows                  | `permissionsRegistry.addPermissionRules` with `temporalWorkflowPermissionResourceRef`                                                                                         | `temporal-node/alpha`                   |
| Restrict who may do what                            | A Backstage permission policy using the permissions and conditions of the plugin                                                                                              | [Permissions](../README.md#permissions) |

A custom action receives a Temporal client that can reach every workflow of the
namespace with the backend's credentials, while the permission was only checked
for the workflow of the request. An action that touches other workflows must check
permissions for those itself; see [Extending](../README.md#extending).

## Design decisions

These are decisions the code relies on, with their reasons.

- **Read-only core; writes in separate modules.** An installation that only wants
  to look at workflows can be sure that the backend has no route that changes
  them. Operating is opt-in at install time, not just at policy time.
- **One access service, shared.** Read paths and operation paths call the same
  `loadWorkflow()`. Modules reuse it through `temporalAccessServiceRef` instead
  of repeating the checks, so there is one definition of "who may see this
  workflow". The interface is the one deliberate contract in the plugin (see
  [CONTRIBUTING.md](../CONTRIBUTING.md#backend-layout)).
- **Shared definitions in a common library.** Frontend and backend must agree on
  types, permission names and paths. `temporal-common` is that single source;
  its tests check the permissions against a fixture.
- **No database in the plugin.** Temporal already is the system of record. The
  plugin queries it each time and keeps only small in-memory caches (progress of
  closed runs; 32 MiB of downloaded payloads), so there is nothing to migrate or
  to keep consistent.
- **A workflow belongs to an entity by matching, not by registration.** An
  entity's workflows are those with its workflow types on its task queue
  (annotations or `TemporalWorkflow` spec), or with its reference in a search
  attribute. Nothing is stored in the catalog per execution.
- **One `TemporalWorkflow` entity is one Workflow Type, and components link with
  `dependsOn`.** It means what the link means ("needs this to work"), the catalog
  graph and the about card already show it, and it needs no processor for other
  kinds ([README](../README.md#workflow-entities)).
- **Workflows are a permission resource.** `temporal.workflow.list` and
  `temporal.workflow.history.list` are resource permissions on `temporal-workflow`
  with rules (workflow type, task queue, namespace, initiator) that the backend
  turns into a Temporal visibility query for lists. Entity permissions stay on
  the catalog entity, so catalog rules (such as `isEntityOwner`) work.
- **Downloads go through the backend, with no presigned URLs.** A presigned URL
  works for anyone who has it until it expires, outside Backstage's permission
  checks. The cost is that data passes through the backend, with a size limit
  ([Large payloads](../README.md#large-payloads-external-storage)).
- **Plain classes, no abstraction in advance.** No repository interfaces and no
  container: the layers are folders, and `plugin.ts` passes the objects to each
  other.
- **The SDK's version drives the plugin's version.** The backend uses
  `@temporalio/client` `~1.24.0`; while the packages are `0.x`, a new minor of
  it is a new minor of the plugin packages, and from `1.0.0` a new major of it
  is a new major
  ([Compatibility](../README.md#compatibility)).
- **Optional packages stay out of apps that do not need them.** The Zigflow tab is
  two packages, so apps without Zigflow carry no YAML editor; the AI views are
  behind a flag and their worker-side kit is not published.
- **Formats written by workers are tested on both sides.** The workflow kit writes
  the loop markers and LLM records, and the backend reads them with its own code;
  both are tested against shared fixtures (`test-fixtures/`).

Back to [the documentation index](README.md).
