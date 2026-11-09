# @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow

Unofficial module of the Backstage Temporal backend plugin
([`@kwkevinchan/backstage-plugin-temporal-backend`](../temporal-backend/README.md))
for workflows written in the Serverless Workflow DSL and run by
[Zigflow](https://github.com/zigflow/zigflow).

## Purpose

Serves the definition file of a `TemporalWorkflow` entity
(`spec.definition`) for the **Definition** tab of
[`@kwkevinchan/backstage-plugin-temporal-module-zigflow`](../temporal-module-zigflow/README.md):
`GET /api/temporal/entities/:kind/:namespace/:name/definition`, with the
`temporal.workflow.read` permission on the entity. The file is read with the
URL reader of the configured integrations and parsed as plain YAML, with the
lines of each task.

## Installation

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow
```

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow'),
);
```

The entity, the reading rules and the configuration
(`temporal.definitions`) are described in the
[README of the frontend package](../temporal-module-zigflow/README.md).
