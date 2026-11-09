# Contributing

Thanks for your interest. The project is pre-alpha, so please open an issue to
discuss larger changes before sending a pull request.

## Workflow

1. Fork the repository and create a branch from `main`.
2. `corepack enable && yarn install` (this also installs the git hooks).
3. Make your change, with tests where it makes sense.
4. Run the checks locally:

   ```sh
   yarn tsc && yarn lint:all && yarn test && yarn build:all
   yarn constraints && yarn boundaries && yarn sync:common:check
   ```

5. If a published package (`plugins/*`) changes, add a changeset with
   `yarn changeset` and describe the change for users.
6. Open a pull request against `main`.

## Shared definitions

The permissions, types, annotation constants, API paths and the
`TemporalWorkflow` entity schema live in `plugins/temporal-common`
(`@kwkevinchan/backstage-plugin-temporal-common`). Backstage does not let a
frontend plugin import a backend plugin, so both import this package; its
tests check the permissions against `test-fixtures/permissions.json`.

The Zigflow modules share one file by copying instead:
`plugins/temporal-backend-module-zigflow/src/common` is the original,
`plugins/temporal-module-zigflow/src/common` the copy. Edit the backend file
and run `yarn sync:common`; the `pre-commit` hook and CI fail when the copy is
out of date.

The backend reads the loop markers and LLM records with its own code; the
workflow kit writes them. Both are tested against
`test-fixtures/loop-markers.json` and `test-fixtures/llm-records.json`, so
change the format there first. Large payloads use Temporal External
Storage: the backend tests read payloads written by the official S3 driver
(`plugins/temporal-backend/src/__testUtils__/externalStorage.ts`).

The root `package.json` depends on `protobufjs@^8` only so that one copy of
it is hoisted: `@temporalio/common` and `@temporalio/proto` must share it,
or External Storage fails with "type must be a Type" (other dependencies
want protobufjs 7).

## Backend layout

`plugins/temporal-backend/src` has four folders; a request goes down them in
order:

| Folder          | Holds                                                                      | In clean-architecture terms |
| --------------- | -------------------------------------------------------------------------- | --------------------------- |
| `routes/`       | Express handlers: parse and validate the request, call access and services | Controllers                 |
| `access/`       | `DefaultTemporalAccessService`: permission checks and catalog lookups      | Authorization               |
| `services/`     | `WorkflowQueries` and the conversions from Temporal data to API types      | Use cases                   |
| `repositories/` | `TemporalReadRepository` (Temporal calls) and `PayloadStore` (S3)          | Gateways                    |

The API types (the model) are in `plugins/temporal-common`, and the shared
Temporal client and extension point in `plugins/temporal-node`. The classes
are plain; there are no interfaces or DI container inside the plugin.
`plugin.ts` creates them and wires them together.

## Git hooks and boundary checks

The `pre-commit` hook runs `scripts/check-boundaries.mjs` on the staged changes,
plus [gitleaks](https://github.com/gitleaks/gitleaks) when it is installed. The
`commit-msg` hook checks the commit message. CI runs the same checks on every
pull request.

The boundary check rejects local file system paths, private keys, access tokens
and private package registries. You can add your own terms, one per line, in
`~/.config/boundary/denylist.txt` or the `BOUNDARY_DENYLIST` environment
variable. Never commit that list.

Please commit with your GitHub noreply email address.

## License

By contributing you agree that your contributions are licensed under the
[Apache License, Version 2.0](LICENSE).
