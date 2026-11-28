# @kwkevinchan/backstage-plugin-temporal-module-zigflow

Unofficial module of the Backstage Temporal plugin
([`@kwkevinchan/backstage-plugin-temporal-frontend`](../temporal-frontend/README.md)) with the
**Definition** tab for workflows written in the Serverless Workflow DSL and
run by [Zigflow](https://github.com/zigflow/zigflow). It reads the
definitions through the backend module
[`@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`](../temporal-backend-module-zigflow/README.md).
Apps without Zigflow workflows do not need either package.

Workflows written in YAML can show their definition on the **Definition**
tab of their `TemporalWorkflow` entity. The format is the CNCF Serverless
Workflow DSL 1.0 (now called the Open Workflow Specification) in the flavor
that [Zigflow](https://github.com/zigflow/zigflow) 0.18 runs on Temporal:
`document.dsl: 1.0.0`, `document.workflowType` and `document.taskQueue`
(the standard `document.name` works too).

| Definition tab: YAML and graph                              | A run on top of the graph                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| ![YAML next to its graph](../../docs/images/definition.png) | ![A run laid over the definition](../../docs/images/definition-run.png) |

## Installation

Install the Temporal plugin first, the backend plugin (which brings the
`TemporalWorkflow` kind) and the frontend plugin (see the
[main README](../../README.md)). Without the backend module below, the tab
shows "The definition could not be loaded" and says that the backend serves
no workflow definitions.

Backend:

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow
```

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow'),
);
```

The module adds its route to the Temporal backend plugin
(`/api/temporal/entities/:kind/:namespace/:name/definition`).

Frontend, new frontend system:

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal-module-zigflow
```

```tsx
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import temporalZigflowModule from '@kwkevinchan/backstage-plugin-temporal-module-zigflow/alpha';

export default createApp({
  features: [temporalPlugin, temporalZigflowModule /* ... */],
});
```

The module adds the **Definition** tab (`entity-content:temporal/definition`)
to `TemporalWorkflow` entities.

Frontend, legacy frontend system: add the route to the `TemporalWorkflow`
page of `EntityPage.tsx`:

```tsx
import { EntityTemporalDefinitionContent } from '@kwkevinchan/backstage-plugin-temporal-module-zigflow';

<EntityLayout.Route path="/definition" title="Definition">
  <EntityTemporalDefinitionContent />
</EntityLayout.Route>;
```

`EntityTemporalDefinitionContent` is the only export of the package root;
the new frontend system uses the default export of `./alpha`.

The YAML is shown in a read-only [CodeMirror 6](https://codemirror.net/)
editor, using only its official packages (`@codemirror/view`, `state`,
`language`, `lang-yaml` and `@lezer/highlight`, all MIT): about 290 KB
minified (95 KB gzipped), loaded with the tab. The selected task, the cursor
and a parse error are line decorations of the editor, so they always line up
with the text.

## The entity

```yaml
apiVersion: temporal.io/v1alpha1
kind: TemporalWorkflow
metadata:
  name: order-fulfillment
spec:
  owner: group:default/orders-team
  workflowType: order-fulfillment
  taskQueue: orders-zigflow
  definition:
    format: serverless-workflow
    target: ./workflows/order-fulfillment.yaml
```

`spec.definition` has two required fields:

| Field    | Meaning                                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format` | `serverless-workflow` (a YAML workflow, drawn as a graph).                                                                                                                          |
| `target` | A relative path within the entity's repository (`backstage.io/managed-by-location`), or an absolute `http(s)` URL allowed by `temporal.definitions.allow`. At most 2048 characters. |

Why this shape: `target` means the same as `spec.target` of Backstage
`Location` entities (relative or absolute), and an object with a `format`
can take other DSLs later. The file is not inlined into the entity (as
`$text` placeholders of API entities are): the catalog would store a copy
of every file in every entity, without the size limit and the checks below,
and would show changes only after the next refresh. The backend reads the
file when the tab opens instead.

Without `spec.definition`, the Definition tab of a workflow written in code
links to the source from the `backstage.io/source-location` and
`backstage.io/view-url` annotations, without reading any file.

## Reading the file

- A relative `target` is resolved against the entity's
  `backstage.io/managed-by-location` with the integration's rules and must stay
  in the same repository: same integration, repository and branch for GitHub,
  GitLab, Bitbucket Cloud and Server, Azure DevOps and Gitea. Each of these URL
  shapes is recognized only on hosts of its own integration type (and on hosts
  without an integration). On other hosts, such as Gerrit, AWS CodeCommit and
  Harness, and for other URL shapes, such as S3 objects, the target must stay
  in the folder of the entity file or below it. For an entity file at the root
  of a host without an integration, that folder is the whole host: the bucket
  for an S3 virtual-hosted URL such as
  `https://my-bucket.s3.us-east-1.amazonaws.com/catalog-info.yaml`, and every
  path of any other host. To narrow it, give the host `paths` in
  `backend.reading.allow`. S3 path-style hosts, where the first path segment
  is the bucket, are excluded. Paths climbing out with `..` or resolving to
  another repository are rejected. The file must be within that allowed
  scope (the entity's repository or folder for relative targets, or
  the allowed `host` and `paths` for absolute URLs) up to `maxBytes`.
- An absolute `http(s)` URL is rejected by default and read only when its host
  and `paths` prefix match `temporal.definitions.allow`. When `paths` is omitted
  on a host with a configured Backstage integration, entity authors can read
  any repository accessible to that integration's credentials, so `paths` must
  be configured on integration-backed hosts. URLs with a user name or
  password and other URL schemes are rejected.
- The backend reads remote URLs through Backstage's URL reader, so the
  host must also be allowed by a configured integration (or
  `backend.reading.allow`). `temporal.definitions.allow` checks only the initial
  URL; redirects are governed by the `UrlReader` implementation
  (`FetchUrlReader` validates redirects against `backend.reading.allow`,
  `HarnessUrlReader` allows same-origin or `backend.reading.allow`, and SCM
  integration readers follow default `fetch` redirects).
- Files above `temporal.definitions.maxBytes` (default 1 MiB, at most 8 MiB)
  are not read; the backend stops reading at the limit.
- A successful read of a URL is kept in memory for
  `temporal.definitions.cacheTtlSeconds` (default 30 seconds), so a change in
  the repository shows after at most that time. Failed reads are not cached.
  Simultaneous requests for one URL share one read, and
  `maxConcurrentReads` and `maxReadsPerMinute` cap the reads to the source
  host. The cache is per backend process; instances do not share it.
- A `serverless-workflow` target must be a `.yaml` or `.yml` file.
- The YAML is parsed without running anything: YAML 1.2 core schema, no
  custom tags, no merge keys, unique keys, at most 20 aliases, at most 64
  levels of nesting, and data at most four times the size of the file, so
  "billion laughs" files fail instead of filling the memory. A file with an
  error is not shown: the page shows the error, with its line for invalid
  YAML.
- Entities from `file:` locations (a development catalog) are read only with
  `temporal.definitions.readFileLocations: true`. The target must stay in the
  folder of the entity file or below it, also after symlinks are resolved,
  and must be a regular file (not a directory, device or FIFO). Keep
  `readFileLocations` off outside local development.
- The route is `GET /entities/:kind/:namespace/:name/definition` and needs
  `temporal.workflow.read` on the entity, like the workflow list: a
  definition describes the workflow, without inputs or results.

## The tab

- Left: the YAML, read-only, with line numbers and colors. Pressing a line
  (or moving with the arrow keys) selects the innermost task around it.
- Right: the graph, drawn and laid out like the step graph of a run (React
  Flow and dagre, top to bottom, at least 12px text at the zoom it opens
  with). Pressing a box marks its lines in the YAML and scrolls to them.

| Task                         | Drawn as                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `call`, `run`, `set`, `emit` | A box with what it calls or runs (activity, HTTP, gRPC, child workflow, shell, ...)       |
| `switch`                     | A box with one arrow per case, labeled with the case, to its `then`                       |
| `fork`                       | A box, one arrow per branch, and a **Join** (or **First to finish** with `compete`) box   |
| `for` (with `while`)         | A box, an arrow into the body (`each`), a dashed arrow back (`next`) and one out (`done`) |
| `try` / `catch`              | A box, its body, a **Catch** box reached by a dashed red arrow, an arrow back for `retry` |
| `wait`, `listen`             | A box with the duration, or the signal, update or events it waits for                     |
| `do`                         | A box followed by its tasks                                                               |
| `raise`                      | A box without an arrow out                                                                |
| anything else                | A plain box marked **unsupported**; the rest of the graph is drawn as usual               |

`then: continue | exit | end | <task>` on tasks and cases are followed;
`if` and the retry policy of `metadata.activityOptions` show as badges.

## A run on top

**Show a run** lists the recent runs of the entity. The boxes of the tasks
then take the colors of the run: done, running, failed, and dimmed for
tasks the run did not reach (in a closed run) or has not reached yet. A
task that ran more than once (a loop) shows how many times. **Open the run**
opens its details on the Temporal tab.

The history of a run does not name the tasks. The tab matches events to
tasks by the names Zigflow 0.18 gives what it starts:

| Task                                                         | Event in the history                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `call: http`, `call: grpc`, `run` (shell, script, container) | Activity of type `<workflowType>.<task path>` (names from the top, with `try` and `catch` segments; `.` and `\` escaped) |
| `call: activity`                                             | Activity of the type in `with.name`                                                                                      |
| `run: workflow`                                              | Child workflow of the type in `workflow.type`                                                                            |
| A `fork` branch                                              | Child workflow `workflow_fork_<fork>_<branch>`                                                                           |
| The target of a `switch` case (a `do` task)                  | Child workflow named after the task                                                                                      |
| `listen` for signals or updates                              | The signals or updates by name (`all`: every one must arrive)                                                            |

Not marked, because no event names them: `set`, `switch`, `wait` (its timer
has no name), `raise`, the boxes of `do`, `for` and `try`, and tasks that
run inside a child workflow (fork branches, switch targets). A name that two
tasks share (two `call: activity` of the same activity) is not marked
either, since the history cannot tell them apart. Steps of the run that
match no task are counted under the legend; if no step matches any task, the
tab warns and marks identifiable tasks `Unknown` instead of `Not reached`.

## Configuration

Under `temporal` in `app-config.yaml`, read by the backend module:

```yaml
temporal:
  definitions:
    maxBytes: 1048576
    cacheTtlSeconds: 30
    cacheMaxEntries: 100
    maxConcurrentReads: 4
    maxReadsPerMinute: 120
    readFileLocations: false
    # allow:
    #   - host: raw.githubusercontent.com
    #     paths:
    #       - /my-org/my-workflows/
```

| Key                              | Default   | Description                                                                                                                                                                                                           |
| -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definitions.allow`              | `[]`      | Hosts (`host`, supporting leading `*.` wildcard and `:port` or `:start-end` range) and `paths` prefixes allowed for absolute `http(s)` `target` URLs; `paths` must be set on hosts backed by a Backstage integration. |
| `definitions.maxBytes`           | `1048576` | Largest definition file read, in bytes (at most 8 MiB).                                                                                                                                                               |
| `definitions.cacheTtlSeconds`    | `30`      | How long a definition read from a URL stays in the memory of the backend process, in seconds (`0` turns the cache off, at most 600). The cache is not shared between backend processes.                               |
| `definitions.cacheMaxEntries`    | `100`     | Most definition files the cache keeps; the least recently used is dropped.                                                                                                                                            |
| `definitions.maxConcurrentReads` | `4`       | Most URL reads that run at the same time per backend process; the others wait.                                                                                                                                        |
| `definitions.maxReadsPerMinute`  | `120`     | Most URL reads (cache hits not counted) started per minute per backend process; above it the tab shows an error until the minute ends.                                                                                |
| `definitions.readFileLocations`  | `false`   | Read definitions next to entities from `file:` locations (development catalogs).                                                                                                                                      |
