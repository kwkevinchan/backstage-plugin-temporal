# Histories with Temporal Event Groups

Event histories of workflows that use Temporal Event Groups, in the
protobuf JSON form of `temporal workflow show --output json`, recorded with
Temporal server 1.32.1. The backend tests of the event groups
(`plugins/temporal-backend/src/services/eventGroups.test.ts` and
`plugins/temporal-backend/src/eventGroupRoutes.test.ts`) read them. Task
queues, workflow types, workflow IDs and worker identities were renamed.

The files are left as the CLI wrote them, where times are ISO strings
(`"eventTime": "2026-…Z"`) and durations are strings like `"2s"`. The plugin
reads `HistoryEvent.toJSON()`, where both are `{ seconds, nanos }`, so the
tests read the files through `readHistoryFixture`
(`plugins/temporal-backend/src/__testUtils__/fixtures.ts`), which converts
the time and duration fields and leaves payloads alone.

| File                              | SDK  | What runs                                                                                                                                                                                                                                                             | Groups                                                                            |
| --------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `loop-ts-sdk-1.24.json`           | 1.24 | A loop of three rounds in a group, each round in a nested group: `draft`, a 2 second timer, `review` (with a summary). In round 2 the signal `hint` runs `notify` in its handler. Then a `notify` with the group given as an activity option, and one without groups. | `loop:draft-review`, `loop:draft-review:1` to `:3`, `wrap-up`, the signal's group |
| `loop-ts-sdk-1.25.json`           | 1.25 | The same workflow with the 1.25 API (`createEventGroup(id, { label })`); the markers are the same as with 1.24.                                                                                                                                                       | as above                                                                          |
| `child-local-activity.json`       | 1.25 | A loop of two rounds; round 2 runs a local activity and starts a child workflow. Then a child workflow started with a group as an option.                                                                                                                             | `loop:child`, `loop:child:1`, `loop:child:2`, `extra:child-option`                |
| `child-local-activity.child.json` | 1.25 | The child workflow of round 2: it does not inherit the parent's groups; one `notify` is in its own group.                                                                                                                                                             | `child:own`                                                                       |
| `parallel.json`                   | 1.25 | Two groups in parallel (`Promise.all`), the first with a nested group; then steps with two tag groups given as options, one in the scope of the first group.                                                                                                          | `par:a`, `par:a:sub`, `par:b`, `tag:x`, `tag:y`                                   |
| `ambiguous.json`                  | 1.25 | A group given as an option to one step inside another group's scope, and two unrelated groups on the same two steps: both read as nesting.                                                                                                                            | `amb:a`, `amb:z`, `amb:p`, `amb:q`                                                |
| `flat.json`                       | 1.25 | A loop of three rounds in one group, without groups for the rounds.                                                                                                                                                                                                   | `loop:flat`                                                                       |
| `no-label-ts-sdk-1.25.json`       | 1.25 | A group without a label.                                                                                                                                                                                                                                              | `label-0`                                                                         |
| `no-id-ts-sdk-1.24.json`          | 1.24 | A group without an ID: the SDK hashes the label.                                                                                                                                                                                                                      | a 40-digit hexadecimal ID, label `Group without id`                               |
| `long-label.json`                 | 1.25 | A label of 4000 characters, stored as it is.                                                                                                                                                                                                                          | `label-4000`                                                                      |
| `continue-as-new.json`            | 1.25 | The first run of a loop that continues as new after two rounds; the continued-as-new event carries the loop's group.                                                                                                                                                  | `loop:can`, `loop:can:1`, `loop:can:2`                                            |
| `codec-loop.json`                 | 1.25 | The loop above without the signal, every payload encrypted with the test key of `temporalio/samples-typescript` (`encryption`): the group IDs are clear text, the labels are encrypted.                                                                               | as `loop-ts-sdk-1.25.json`, without the signal's group                            |

The histories of the official AI integrations in
[`../llm-integrations`](../llm-integrations/README.md) put each round of the
agent in a group too (`loop:agent`, `loop:agent:1`, `loop:agent:2`); the
tests read the tokens of the groups from them.

## Re-recording

The standalone workflows and CLI runners live under
[`scripts/record-fixtures/`](../../scripts/record-fixtures/README.md), outside
the root Yarn workspace so `@temporalio/*` stays pinned to `1.24.0` and
`1.25.0`.

1. Start a local Temporal dev server (`1.32.1` or newer):

   ```bash
   temporal server start-dev --headless --port 7233
   ```

2. Install the pinned SDK packages you want to record with (without modifying
   the root lockfile):

   ```bash
   npm install --prefix scripts/record-fixtures/sdk-1.24 --no-package-lock
   npm install --prefix scripts/record-fixtures/sdk-1.25 --no-package-lock
   ```

3. Run the worker and workflows (writes sanitized JSON to
   `/tmp/recorded-fixtures/event-groups/` by default; use `--only <name>`,
   `--out-dir <dir>`, or `--address` / `TEMPORAL_ADDRESS` as needed):

   ```bash
   node scripts/record-fixtures/sdk-1.24/event-groups/record.mjs
   node scripts/record-fixtures/sdk-1.25/event-groups/record.mjs
   ```

4. If you export a workflow manually instead of using `record.mjs`, pipe the
   CLI JSON through [`sanitize.mjs`](../../scripts/record-fixtures/sanitize.mjs)
   so client/worker identities become `client` / `worker@host`, failure
   `stackTrace` strings are truncated to their first line, and names match the
   committed fixture:

   ```bash
   temporal workflow show --workflow-id <id> --run-id <runId> --output json | \
     node scripts/record-fixtures/sanitize.mjs \
       --workflow-type <name> \
       --task-queue <queue> \
       --rename-workflow-id <old=new> \
       --rename-child-type <old=new> \
       --out /tmp/recorded-fixtures/event-groups/<name>.json
   ```

5. Compare the new output against the committed JSON (event counts, event
   group keys/labels, and `yarn backstage-cli repo test --selectProjects temporal-backend temporal-frontend`),
   run `node scripts/check-boundaries.mjs --file <recorded-files>` before copying
   anything into `test-fixtures/event-groups/`, and regenerate snapshots with
   `yarn sync:test-graphs` if graph shapes changed. Remove any temporary
   `scripts/record-fixtures/sdk-*/node_modules` directories afterward.
