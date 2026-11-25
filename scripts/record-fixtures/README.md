# Recording test fixtures

Standalone workflows and CLI runners for regenerating the JSON histories in
`test-fixtures/event-groups/` and `test-fixtures/llm-integrations/`.

These packages are intentionally excluded from the root Yarn workspace so their
pinned Temporal SDK (`1.24.0` / `1.25.0`) and offline AI SDK dependencies stay
separate from the Backstage plugin workspace.

## Prerequisites

1. Start a local Temporal dev server (`1.32.1` or newer):

   ```bash
   temporal server start-dev --headless --port 7233
   ```

2. Install dependencies inside the SDK directory you want to record with:

   ```bash
   npm install --prefix scripts/record-fixtures/sdk-1.24 --no-package-lock
   npm install --prefix scripts/record-fixtures/sdk-1.25 --no-package-lock
   ```

## Runners

By default, every runner writes sanitized JSON files under
`/tmp/recorded-fixtures` so committed files in `test-fixtures/` are not
overwritten until you compare and copy them explicitly. Pass `--out-dir` to
choose a different output directory, `--only <fixture-name>` to record a single
fixture, and `TEMPORAL_ADDRESS` (or `--address`) for a non-default server.

- **Event Groups (SDK 1.24)** (`loop-ts-sdk-1.24`, `no-id-ts-sdk-1.24`):

  ```bash
  node scripts/record-fixtures/sdk-1.24/event-groups/record.mjs
  ```

- **Event Groups (SDK 1.25)** (`loop-ts-sdk-1.25`, `child-local-activity`,
  `parallel`, `ambiguous`, `flat`, `no-label-ts-sdk-1.25`, `long-label`,
  `continue-as-new`, `codec-loop`):

  ```bash
  node scripts/record-fixtures/sdk-1.25/event-groups/record.mjs
  ```

- **OpenAI Agents SDK (SDK 1.24)** (`openai-agents-agent`,
  `openai-agents-parallel-tools`, `openai-agents-reasoning`,
  `openai-agents-streaming`, `openai-agents-summary`):

  ```bash
  node scripts/record-fixtures/sdk-1.24/openai-agents/record.mjs
  ```

- **Vercel AI SDK (SDK 1.24)** (`vercel-ai-sdk-agent`):

  ```bash
  node scripts/record-fixtures/sdk-1.24/vercel-ai-sdk/record.mjs
  ```

- **Vercel AI SDK (SDK 1.25)** (`vercel-ai-sdk-parallel-tools`,
  `vercel-ai-sdk-streaming`, `vercel-ai-sdk-summary`,
  `codec-vercel-ai-sdk-agent`):

  ```bash
  node scripts/record-fixtures/sdk-1.25/vercel-ai-sdk/record.mjs
  ```

## Sanitizing manual exports

All model providers and MCP servers above run offline fakes. To sanitize any
manually exported history from `temporal workflow show --output json`:

```bash
temporal workflow show --workflow-id <id> --run-id <runId> --output json | \
  node scripts/record-fixtures/sanitize.mjs --workflow-type <name> --task-queue <queue> > out.json
```

`sanitize.mjs` normalizes client/worker identities (`client` / `worker@host`),
truncates failure stack traces to their first line, and applies optional
workflow/task-queue/child renames while preserving payload bytes.

- Sticky task queue names are always rewritten to `worker@host-<uuid>`, with or
  without `--task-queue`, so no process ID or host name stays in the file.
  With `--task-queue`, the `normalName` of a sticky queue is renamed as well.
- `--workflow-type` renames only the run's own type (the started and
  continued-as-new events). Child workflow types change only through
  `--rename-child-type`.

## What a re-recording guarantees

Run the sanitizer tests and the codec test before you copy a recording into
`test-fixtures/`; neither needs a Temporal server:

```bash
node scripts/record-fixtures/sanitize.test.mjs
node scripts/record-fixtures/common/encryption-codec.test.mjs
```

The Event Groups recorders write the labels and payload text of the committed
files. The encrypted `codec-loop` file uses the key of the `encryption` sample
in `temporalio/samples-typescript`, and the plain-text sample
`S3CR3T-明文-42` is in its input and its static summary, so a recording shows
that the plain text stays out of the encrypted history.

The recorders for `test-fixtures/llm-integrations/` guarantee only the same
events, event groups, and model calls as the committed files. The labels and
payload text can differ. This holds most of all for
`codec-vercel-ai-sdk-agent`, which a different workflow (`aiSdkSummary`)
produces; only its static summary carries the plain-text sample.

After a recording, compare it against the committed file and run the backend
and frontend tests before you replace anything:

```bash
CI=true yarn backstage-cli repo test --selectProjects @kwkevinchan/backstage-plugin-temporal-backend @kwkevinchan/backstage-plugin-temporal-frontend
```
