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
   yarn lint:openapi
   ```

5. If a published package (`plugins/*`) changes, add a changeset with
   `yarn changeset` and describe the change for users.
6. Open a pull request against `main`.

## Releasing

Releases are cut by the maintainer from `main`, with
[changesets](https://github.com/changesets/changesets). The first release
takes every published package from `0.0.0` to `0.1.0`: the six packages
`@kwkevinchan/backstage-plugin-temporal-backend`, `-temporal-frontend`,
`-temporal-backend-module-zigflow`, `-temporal-module-zigflow`,
`-scaffolder-backend-module-temporal` and `-scaffolder-module-temporal`
(all under `@kwkevinchan/backstage-plugin-`).

1. `yarn changeset version`: bumps the versions (the first-release
   changesets are `minor`), updates the internal dependency ranges and
   writes the changelogs. Then `yarn install` (not `--immutable`: the
   workspace versions are in `yarn.lock`). Review and commit both in a pull
   request.
2. On the merged `main`: `yarn install --immutable`, then
   `yarn tsc:full && yarn lint:all && yarn test && yarn build:all`.
3. Check what each package will contain:
   `yarn workspace <package> pack --dry-run` lists the files: `dist/`, its
   `README.md`, `LICENSE`, where it has one, `config.d.ts`, and for the
   backend plugin `src/schema/openapi.yaml`. Then
   `yarn workspace <package> pack` and look at the `package.json` inside the
   tarball: `main`/`types` (and `exports`) point at `dist/`, and the
   `workspace:^` ranges are replaced by version ranges.
4. Publish with Yarn, which replaces the `workspace:` ranges (plain
   `npm publish` does not). Yarn does not read `~/.npmrc`: log in with
   `yarn npm login` (or set `npmAuthToken` in `~/.yarnrc.yml`), then run
   `yarn workspaces foreach --all --no-private --topological npm publish --access public --tolerate-republish`
   (with two-factor authentication, add `--otp <code>` after
   `npm publish`), then `yarn changeset tag` and `git push --follow-tags`.

Private packages (`"private": true`) are not published. At the moment that
is `@kwkevinchan/temporal-workflow-kit`, which goes with the experimental AI
views (`temporal.experimental.aiWorkflows`) and will be released with them.

## Package layers

The plugin is one backend and one frontend package; the other four are
modules that build on the package of their side:

| Package                              | Depends on (of this repository) |
| ------------------------------------ | ------------------------------- |
| `temporal-backend`                   | nothing                         |
| `temporal-frontend`                  | nothing                         |
| `temporal-backend-module-zigflow`    | `temporal-backend`              |
| `scaffolder-backend-module-temporal` | `temporal-backend`              |
| `temporal-module-zigflow`            | `temporal-frontend`             |
| `scaffolder-module-temporal`         | `temporal-frontend`             |

`yarn constraints` (`yarn.config.cjs`) checks these directions: frontend
packages never depend on backend packages or Node-only packages, the two
core packages depend on no other workspace, a module only on the core of
its side, and no published package on a private one.

## Shared definitions

The permissions, types, annotation constants, API paths and the
`TemporalWorkflow` entity schema live in
`plugins/temporal-backend/src/common` (exported as
`@kwkevinchan/backstage-plugin-temporal-backend/common`). Backstage does not
let a frontend plugin import a backend plugin, so the frontend package has a
copy in `plugins/temporal-frontend/src/common` (exported as
`@kwkevinchan/backstage-plugin-temporal-frontend/common`). Edit the backend
files and run `yarn sync:common`; the `pre-commit` hook and CI fail when the
copy is out of date. The tests stay with the backend files; they check the
permissions against `test-fixtures/permissions.json`.

The Zigflow modules share one file in the same way:
`plugins/temporal-backend-module-zigflow/src/common` is the original,
`plugins/temporal-module-zigflow/src/common` the copy.

The backend reads the loop markers and LLM records with its own code; the
workflow kit writes them. Both are tested against
`test-fixtures/loop-markers.json` and `test-fixtures/llm-records.json`, so
change the format there first. The LLM adapters of the official Temporal AI
integrations are tested against recorded histories in
`test-fixtures/llm-integrations` (see its README; rename task queues,
workflow types and IDs, worker identities and paths before adding one).
Large payloads use Temporal External
Storage: the backend tests read payloads written by the official S3 driver
(`plugins/temporal-backend/src/__testUtils__/externalStorage.ts`).

The root `package.json` depends on `protobufjs@^8` only so that one copy of
it is hoisted: `@temporalio/common` and `@temporalio/proto` must share it,
or External Storage fails with "type must be a Type" (other dependencies
want protobufjs 7).

## Backend layout

`plugins/temporal-backend/src` has four folders a request goes down in
order, and three for the other parts of the package:

| Folder          | Holds                                                                                                                       | In clean-architecture terms |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `routes/`       | Express handlers: parse and validate the request, call access and services (`router.ts` reads, `controlRoutes.ts` operates) | Controllers                 |
| `access/`       | `DefaultTemporalAccessService`: permission checks and catalog lookups                                                       | Authorization               |
| `services/`     | The query classes below, `WorkflowCommands` and the conversions from Temporal data to API types                             | Use cases                   |
| `repositories/` | `TemporalReadRepository` (Temporal calls) and `PayloadStore` (S3)                                                           | Gateways                    |
| `common/`       | The shared definitions (`./common`)                                                                                         | Model                       |
| `node/`         | `temporalServiceRef`, the extension points and the access service interface (`./node`, `./alpha`)                           | Ports for modules           |
| `catalog/`      | The catalog module with the `TemporalWorkflow` kind                                                                         |                             |

The query classes in `services/` each cover one kind of read:

| Class                   | Holds                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `EntityWorkflowSources` | Entity context, the search filter of an entity's workflows, workflow sources and the namespace checks     |
| `WorkflowListQueries`   | The workflows of an entity and of a namespace, statistics, schedules and the progress of runs in a list   |
| `WorkflowQueries`       | One workflow: details, membership of an entity, history, steps, graph, run position, queries and handlers |
| `AiWorkflowQueries`     | The experimental AI views: loops and model call records                                                   |

`EntityWorkflowSources` is used by the other three, and `WorkflowQueries` by
`WorkflowListQueries` and `AiWorkflowQueries`; none of them depends on a
class that uses it. The access service uses `EntityWorkflowSources` and
`WorkflowQueries`; the router uses all four. The LLM adapters (model calls and tool calls) and their views are in
`services/llm/` (backend) and `components/llm/` (frontend).

The classes are plain; there are no repository interfaces or DI container
inside the plugin. `plugin.ts` creates them and wires them together, and
mounts the routes that change workflows (`createControlRouter`) unless
`temporal.control.enabled` is false. `WorkflowCommands` calls Temporal
directly until a separate write connection needs a gateway of its own.

The one interface is `TemporalAccessService` in `src/node/alpha.ts`: the
contract between the plugin and its modules (`temporalAccessServiceRef`).

## HTTP API spec

`plugins/temporal-backend/src/schema/openapi.yaml` (OpenAPI 3.1, where the
Backstage tooling looks for it) describes every route under
`/api/temporal`, including the definition route of the Zigflow backend
module. Change it together with the routes and the types in `src/common`:

- `yarn lint:openapi` lints it with the Backstage rules
  (`backstage-repo-tools repo schema openapi lint --strict`) and validates it
  (`package schema openapi validate`).
- `src/schema/openapi.test.ts` compares the routes the routers mount with the
  operations of the spec, and `x-temporal-control` with the routes of
  `createControlRouter`; the Zigflow module has the same test for its route.
- The route tests send their requests through the validating proxy of
  `@backstage/backend-openapi-utils` (`withOpenApiValidation` in
  `src/__testUtils__/openapi.ts`): a parameter, body, status code or
  response field that the spec does not describe fails the test. Requests to
  paths that are not in the spec (other plugins, routes that are switched
  off) go to the test backend directly. The payload download is not
  checked: the proxy only reads JSON responses.

The routers are plain Express routers; nothing is generated from the spec.

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
