# Backstage plugin for Temporal

> **Unofficial.** This project is a community plugin. It is not affiliated with,
> endorsed by, or supported by Temporal Technologies, Inc. or the Backstage
> project. "Temporal" is used only to describe what the plugin connects to.

**Status: pre-alpha.** Nothing is published yet and every API may change. The
packages in this repository are skeletons; the first usable release is planned
as `0.1.0`.

The plugin aims to show [Temporal](https://temporal.io) workflows next to the
catalog entities that own them in [Backstage](https://backstage.io): a list of
workflow executions per entity, execution details and event history, and later
permission-checked controls (signal, cancel, re-run).

## Packages

| Package                                                                      | Role            | Description                                                                             |
| ---------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| [`@kwkevinchan/backstage-plugin-temporal`](plugins/temporal)                 | frontend-plugin | Pages and entity content. Legacy entry point and `./alpha` for the new frontend system. |
| [`@kwkevinchan/backstage-plugin-temporal-backend`](plugins/temporal-backend) | backend-plugin  | REST API under `/api/temporal`, permission checks.                                      |
| [`@kwkevinchan/backstage-plugin-temporal-common`](plugins/temporal-common)   | common-library  | Shared types, permissions and annotation constants.                                     |
| [`@kwkevinchan/backstage-plugin-temporal-node`](plugins/temporal-node)       | node-library    | Shared Temporal client service and backend extension points.                            |

Development-only packages (never published): `packages/app` (legacy frontend
system), `packages/app-next` (new frontend system) and `packages/backend`.

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

Dependency versions of `@backstage/*` packages use the `backstage:^` range,
resolved from the release in `backstage.json` by the Backstage Yarn plugin.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright The backstage-plugin-temporal Authors.

Licensed under the [Apache License, Version 2.0](LICENSE).
