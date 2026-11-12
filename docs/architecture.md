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

![The packages: in the Backstage app, temporal-frontend with its two modules; in the Backstage backend, temporal-backend with its two modules. Each module depends on the core of its side only; the frontend talks to the backend over HTTP and carries its own copy of the shared definitions. The workflow kit belongs to the workers, outside Backstage.](images/package-map.svg)

All names carry the prefix `@kwkevinchan/backstage-plugin-` (except the workflow
kit, `@kwkevinchan/temporal-workflow-kit`). Teal is the core, purple the
optional modules. The [README](../README.md#packages) has the table with the
role of each package and [which ones to install](../README.md#packages).

- **Core, backend** (`temporal-backend`): serves `/api/temporal`, reads and
  operates workflows, checks access, adds the `TemporalWorkflow` kind to the
  catalog, and gives other backend code the shared Temporal client
  (`./node`), the extension points (`./node`, `./alpha`) and the shared
  definitions (`./common`). One `backend.add()` installs all of it.
- **Core, frontend** (`temporal-frontend`): the entity tab, the details page,
  the Workflows page and the buttons of the operations, for both frontend
  systems. It needs the backend.
- **Zigflow** (`temporal-module-zigflow`, `temporal-backend-module-zigflow`): the
  Definition tab. Each one needs the core of its side.
- **Scaffolder** (`scaffolder-backend-module-temporal`,
  `scaffolder-module-temporal`): template actions and the workflow picker field.
- **`temporal-workflow-kit`**: for your Workers, not Backstage. Experimental,
  `private`, not published; it goes with the experimental AI views.
- **Development only** (never published): `packages/app`, `packages/app-next`,
  `packages/backend` and `packages/example-worker`.

What works with what:

| You install                                                      | What you get                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temporal-backend` only                                          | The API (reads, Query, operations unless `temporal.control.enabled` is false), the `TemporalWorkflow` kind, and the shared client and extension points for your own backend code. |
| `temporal-backend` in a backend without the catalog plugin       | The same without the kind: the backend skips the catalog module and logs one line.                                                                                                |
| `temporal-frontend` and `temporal-backend`                       | Every page of the plugin in both frontend systems; no Definition tab and no Scaffolder field.                                                                                     |
| `temporal-frontend` without a reachable `temporal-backend`       | The pages load and show the error of each request (for example `Request failed with 404 Not Found`); nothing works.                                                               |
| Zigflow frontend module without the Zigflow backend module       | The Definition tab says that the backend serves no workflow definitions.                                                                                                          |
| Zigflow backend module without `temporal-backend` (same backend) | The backend skips the module; the route does not exist.                                                                                                                           |
| Scaffolder backend module                                        | The three actions, calling a reachable `temporal-backend` (possibly another backend) as the user. With the operations turned off there, `start` and `signal` fail with a message. |

### Why two core packages

The backend is the core: without a frontend, Backstage backend code can still
call Temporal through it. The frontend always goes with the backend and is
never installed alone. The `TemporalWorkflow` kind is something the backend
needs (it reads the entities to decide which workflows belong to them), so it
comes with the backend. The operations are two halves of one feature, the
routes and the buttons, so each half lives in the core of its side, behind
one key (`temporal.control.enabled`). The aim is the least setup to get
started: one package and one `backend.add()` in the backend, one package in
the app.

The cost:

- **Modules import a backend plugin package.** Backend modules (yours, and the
  Zigflow and Scaffolder ones) import the client service and the extension
  points from `temporal-backend` (`./node`, `./alpha`). Backstage's lint rule
  `@backstage/no-mixed-plugin-imports` prints a warning for that; it does not
  fail the lint. Those entry points do not load the plugin itself (a test
  checks it), but installing a module brings the whole backend package and
  its dependencies (the AWS SDK for S3, for example).
- **The shared definitions exist twice.** A frontend plugin cannot import a
  backend plugin, so `temporal-frontend` carries a copy of the definitions of
  `temporal-backend/src/common`. The copy is generated (`yarn sync:common`)
  and checked in CI, and both sides compare permissions, services and
  extension points by name or ID, so two copies of the objects do not break
  anything.
- **Operating is on by default.** The plugin can change workflows as soon as
  it is installed; who may do so is decided by the permission policy, or the
  key turns it off (see [Security](../README.md#security)).

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

The model (the API types) is in `src/common`, and the shared client in
`src/node`. The classes are plain; `plugin.ts` creates and wires them, and
there is no repository interface and no dependency-injection container inside
the plugin. The routes that change workflows are their own router
(`routes/controlRoutes.ts`), mounted by `plugin.ts` unless
`temporal.control.enabled` is false; `WorkflowCommands` calls Temporal
directly. The parsing of the experimental LLM records is in `services/llm/`.

The access service sits between routes and services but also uses the query
services (it has to read a workflow to decide who may see it). Among the query
services, `EntityWorkflowSources` is used by the other three, and `WorkflowQueries`
by `WorkflowListQueries` and `AiWorkflowQueries`; none depends on a class that
uses it.

On the frontend, `TemporalClient` (the default `temporalApiRef`) reads through the
backend and `TemporalControlClient` (`temporalControlApiRef`) operates. The
buttons of the operations read `temporal.control.enabled` themselves and
render nothing when it is false, in both frontend systems. The screens use
`@backstage/ui`.

## Extension points

You can extend the plugin without changing it. The usage and examples are in
[Extending](../README.md#extending); this table lists what exists.

| You want to                                         | Use                                                                                                                                                                           | Where                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Add a button to the details page                    | `TemporalWorkflowActionBlueprint` (new frontend system) or `workflowActions` (legacy)                                                                                         | `temporal-frontend/alpha`               |
| Add a tab to the details page                       | `TemporalWorkflowSectionBlueprint` or `workflowSections`                                                                                                                      | `temporal-frontend/alpha`               |
| Add a control above the workflow lists              | `TemporalWorkflowListActionBlueprint` or `workflowListActions`                                                                                                                | `temporal-frontend/alpha`               |
| Call the plugin from another plugin                 | `temporalApiRef`, `temporalControlApiRef`                                                                                                                                     | `temporal-frontend`                     |
| Call Temporal from other backend code               | `temporalServiceRef` (`getClient()`)                                                                                                                                          | `temporal-backend/node`                 |
| Add a backend action that changes a workflow        | `temporalControlExtensionPoint.addControlAction()`; served as `POST …/actions/:actionId` with the same access check, its permission, an optional `filter` and an audit record | `temporal-backend/alpha`                |
| Show a backend action as a button                   | `TemporalControlActionBlueprint` or `createTemporalControlActionDef()`                                                                                                        | `temporal-frontend` (`/alpha`)          |
| Add data to workflow summaries                      | `temporalExtensionPoint.addWorkflowEnricher()`                                                                                                                                | `temporal-backend/node`                 |
| Reuse the plugin's access checks in your own routes | `temporalAccessServiceRef` (`loadWorkflow()`, `authorizeOn()`)                                                                                                                | `temporal-backend/alpha`                |
| Decide access in another way                        | Add your own factory for `temporalAccessServiceRef`; the default factory is then skipped                                                                                      | backend                                 |
| Add permission rules for workflows                  | `permissionsRegistry.addPermissionRules` with `temporalWorkflowPermissionResourceRef`                                                                                         | `temporal-backend/alpha`                |
| Restrict who may do what                            | A Backstage permission policy using the permissions and conditions of the plugin                                                                                              | [Permissions](../README.md#permissions) |

A custom action receives a Temporal client that can reach every workflow of the
namespace with the backend's credentials, while the permission was only checked
for the workflow of the request. An action that touches other workflows must check
permissions for those itself; see [Extending](../README.md#extending).

## Design decisions

These are decisions the code relies on, with their reasons.

- **The operations are in the core, behind one key.** `temporal.control.enabled:
false` removes the routes that change workflows (404, not 403) and their
  buttons, so an installation that only wants to look at workflows can be
  sure that the backend has no such route. The extension point for custom
  actions stays registered, so modules that add actions still start.
- **One access service, shared.** Read paths and operation paths call the same
  `loadWorkflow()`. Modules reuse it through `temporalAccessServiceRef` instead
  of repeating the checks, so there is one definition of "who may see this
  workflow". The interface is the one deliberate contract in the plugin (see
  [CONTRIBUTING.md](../CONTRIBUTING.md#backend-layout)).
- **Shared definitions: the backend has the original, the frontend a copy.**
  Frontend and backend must agree on types, permission names and paths.
  `temporal-backend/src/common` is the single source, tested against a
  fixture; `temporal-frontend/src/common` is generated from it and checked in
  CI.
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
- **The SDK's major is the plugin's major.** The backend uses `@temporalio/client`
  1.x; a new major of it is a new major of the plugin packages
  ([Compatibility](../README.md#compatibility)).
- **Optional packages stay out of apps that do not need them.** The Zigflow tab is
  two packages, so apps without Zigflow carry no YAML editor; the AI views are
  behind a flag (the LLM views are in `components/llm/` and `services/llm/`,
  to move to a package of their own) and their worker-side kit is not
  published.
- **Formats written by workers are tested on both sides.** The workflow kit writes
  the loop markers and LLM records, and the backend reads them with its own code;
  both are tested against shared fixtures (`test-fixtures/`).

Back to [the documentation index](README.md).
