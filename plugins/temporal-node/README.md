# @kwkevinchan/backstage-plugin-temporal-node

Node.js library of the unofficial Backstage Temporal plugin.

## Purpose

Backend modules that extend the Temporal backend plugin, or that need the
same Temporal connection, depend on this package.

## Installation

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-node
```

## API

- `temporalServiceRef`: root-scoped service with one shared Temporal
  connection, configured under `temporal.connection` (address, namespaces,
  `auth` with `none` or `bearer`).
- `temporalExtensionPoint`: `addWorkflowEnricher()` adds data to workflow
  summaries; `addControlAction()` adds a custom workflow action, served as
  `POST .../actions/:actionId` and checked with its own permission.

Only `@temporalio/client` is used. See [Extending](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#extending)
in the repository README for an example.
