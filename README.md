# Backstage plugin for Temporal

> **Unofficial.** This project is a community plugin. It is not affiliated with,
> endorsed by, or supported by Temporal Technologies, Inc. or the Backstage
> project. "Temporal" is used only to describe what the plugin connects to.

**Status: pre-alpha.** Nothing is published yet and every API may change. The
first usable release is planned as `0.1.0`.

The plugin shows [Temporal](https://temporal.io) workflows next to the catalog
entities that own them in [Backstage](https://backstage.io): a list of workflow
executions per entity, execution details with failures and pending activities,
and the event history. This version is read-only; permission-checked controls
(signal, cancel, re-run) are planned.

## Packages

| Package                                                                      | Role            | Description                                                                                    |
| ---------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| [`@kwkevinchan/backstage-plugin-temporal`](plugins/temporal)                 | frontend-plugin | Entity tab and workflow details. Legacy entry point and `./alpha` for the new frontend system. |
| [`@kwkevinchan/backstage-plugin-temporal-react`](plugins/temporal-react)     | web-library     | Frontend extension points: API ref, workflow actions and sections, blueprints.                 |
| [`@kwkevinchan/backstage-plugin-temporal-backend`](plugins/temporal-backend) | backend-plugin  | Read-only REST API under `/api/temporal`, permission checks.                                   |
| [`@kwkevinchan/backstage-plugin-temporal-common`](plugins/temporal-common)   | common-library  | Shared types, permissions and annotation constants.                                            |
| [`@kwkevinchan/backstage-plugin-temporal-node`](plugins/temporal-node)       | node-library    | Shared Temporal client service and backend extension point.                                    |

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
annotations.

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
    # Reserved for authentication. Only `none` (no authentication) is
    # supported in this version.
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

| Permission                       | Resource type    | Used for                        |
| -------------------------------- | ---------------- | ------------------------------- |
| `temporal.workflow.read`         | `catalog-entity` | Workflow list and details       |
| `temporal.workflow.history.read` | `catalog-entity` | Event history (inputs, results) |

The plugin registers both permissions and checks them on every request, with
the entity as the resource. Access is open by default: with the permission
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

`TemporalWorkflowSectionBlueprint` adds a card in the same way. In the legacy
system, pass `workflowActions` and `workflowSections` to
`EntityTemporalContent`. Components get the workflow as props or through
`useTemporalWorkflow()`.

Backend modules can add data to workflow summaries with
`temporalExtensionPoint.addWorkflowEnricher()` from
`@kwkevinchan/backstage-plugin-temporal-node`.

## Compatibility

The main line targets Backstage **1.51.x** (see `backstage.json`), which is the
minimum supported version. Newer releases will be tested in CI before the first
release.

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
example `temporal server start-dev --search-attribute BackstageEntityRef=Keyword`).
Start the example workflows for the `example-orders` component with:

```sh
yarn workspace example-worker start
```

Smoke tests sign in as the guest user, open the Temporal tab and two workflows,
and save a screenshot of every step:

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
