# Backstage plugin for Temporal

> **Unofficial.** This project is a community plugin. It is not affiliated with,
> endorsed by, or supported by Temporal Technologies, Inc. or the Backstage
> project. "Temporal" is used only to describe what the plugin connects to.

**Status: pre-alpha.** Nothing is published yet and every API may change. The
first usable release is planned as `0.1.0`.

The plugin shows [Temporal](https://temporal.io) workflows next to the catalog
entities that own them in [Backstage](https://backstage.io): a list of workflow
executions per entity, execution details with failures and pending activities,
and the event history. Workflows can be catalog entities of their own (the
`TemporalWorkflow` kind), and a **Workflows** page lists every workflow of a
namespace. This version is read-only; permission-checked controls (signal,
cancel, re-run) are planned.

## Packages

| Package                                                                                                    | Role                  | Description                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| [`@kwkevinchan/backstage-plugin-temporal`](plugins/temporal)                                               | frontend-plugin       | Entity tab and workflow details. Legacy entry point and `./alpha` for the new frontend system. |
| [`@kwkevinchan/backstage-plugin-temporal-react`](plugins/temporal-react)                                   | web-library           | Frontend extension points: API ref, workflow actions and sections, blueprints.                 |
| [`@kwkevinchan/backstage-plugin-temporal-backend`](plugins/temporal-backend)                               | backend-plugin        | Read-only REST API under `/api/temporal`, permission checks.                                   |
| [`@kwkevinchan/backstage-plugin-temporal-common`](plugins/temporal-common)                                 | common-library        | Shared types, permissions and annotation constants.                                            |
| [`@kwkevinchan/backstage-plugin-temporal-node`](plugins/temporal-node)                                     | node-library          | Shared Temporal client service and backend extension point.                                    |
| [`@kwkevinchan/backstage-plugin-catalog-backend-module-temporal`](plugins/catalog-backend-module-temporal) | backend-plugin-module | Catalog module with the `TemporalWorkflow` kind.                                               |

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

| Permission                       | Resource type    | Used for                        |
| -------------------------------- | ---------------- | ------------------------------- |
| `temporal.workflow.read`         | `catalog-entity` | Workflow list and details       |
| `temporal.workflow.history.read` | `catalog-entity` | Event history (inputs, results) |
| `temporal.workflow.list`         | none (basic)     | Workflows page                  |

The plugin registers the permissions and checks them on every request. The
entity permissions use the entity as the resource. `temporal.workflow.list`
is a basic permission: it allows the Workflows page, which lists every
workflow of the allowed namespaces, and opening any of those workflows
without an entity (details, inputs and outputs, and event history). Give it
only to users who may read every workflow. When a request names an entity
(`entityRef`), the entity permissions are checked as before. Access is open by default: with the permission
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

The main line targets Backstage **1.56.x** (see `backstage.json`), which is the
minimum supported version. Both frontend systems are supported: the legacy
system (`EntityPage.tsx`) and the new frontend system (`./alpha`).

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
a `TemporalWorkflow` entity and its runs, a component that depends on workflow
entities, and the Workflows page from the sidebar, and save a screenshot of
every step:

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
