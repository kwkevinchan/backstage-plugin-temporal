# @kwkevinchan/temporal-workflow-kit

Helpers for Temporal workers whose workflows are shown by the unofficial
[Backstage Temporal plugin](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md).
It is not a Backstage package: install it in your worker, not in Backstage.

| Entry point                               | What it is                                                                                  | Needs                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `@kwkevinchan/temporal-workflow-kit/s3`   | Payload codec: large payloads in S3-compatible storage, a claim check in the history.       | `@aws-sdk/client-s3` 3.350 or later                |
| `@kwkevinchan/temporal-workflow-kit/loop` | Loop markers, a loop state query and continue-as-new helpers. Runs in the workflow sandbox. | `@temporalio/workflow` 1.12 or later (tested 1.24) |

There is no root entry point; import one of the two. Both SDKs are optional
peer dependencies, so a worker installs only what it uses: a worker that
only uses `/loop` does not install the AWS SDK, and `/loop` never loads it
into the workflow bundle.

```sh
# Loops only (your worker already has @temporalio/workflow):
yarn add @kwkevinchan/temporal-workflow-kit
# Large payloads in S3:
yarn add @kwkevinchan/temporal-workflow-kit @aws-sdk/client-s3
```

The Backstage backend reads the claim checks with its own code and does not
need this package. Both implementations are tested against the same
examples (`test-fixtures/claim-checks.json` and
`test-fixtures/loop-markers.json` in the repository).

## `/s3`: large payloads in S3

A Temporal payload codec that stores large payloads in an S3-compatible
object store and keeps a small **claim check** in the workflow history
instead (the claim check pattern). It works with any service that speaks
the S3 protocol: AWS S3, RustFS, MinIO, Ceph, Cloudflare R2 and others.

The [Backstage Temporal plugin](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md) reads the claim checks and
shows the stored data on the workflow page (see
[Large payloads in S3](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#large-payloads-in-s3)).

### How it works

- `encode`: a payload whose data is larger than `thresholdBytes` (default
  128 KiB) is uploaded to S3. The history gets a payload with
  `encoding: json/claim-check` whose data is the claim check as JSON.
  Smaller payloads pass through unchanged.
- `decode`: the data is downloaded, its size and SHA-256 are checked against
  the claim check, and the original payload is restored. A mismatch throws
  `ClaimCheckIntegrityError`.

The claim check (format version 1):

```json
{
  "version": 1,
  "store": "s3",
  "bucket": "temporal-payloads",
  "key": "temporal-payloads/default/order-123/3f2a…c9",
  "size": 1048576,
  "sha256": "3f2a…c9",
  "encoding": "json/plain",
  "contentType": "application/json",
  "metadata": { "messageType": "…base64…" }
}
```

`encoding` and `metadata` are the metadata of the original payload, so
`decode` restores it exactly. `contentType` comes from a `contentType`
metadata entry when the payload has one, `application/json` for `json/*`
encodings, the file type of well-known binary data (PNG, JPEG, GIF, WebP,
PDF, gzip, zip) from its first bytes, and `application/octet-stream`
otherwise. The object in S3 holds the payload data only, so a stored PNG is
a PNG file.

#### Keys

`{prefix}/{namespace}/{workflowId}/{sha256}`, with `prefix` defaulting to
`temporal-payloads`. Parts are URI encoded, so a workflow ID never adds
path segments.

- The SHA-256 makes keys content-addressed: the same data in one workflow
  (retries, repeated results) is one object.
- Everything of one workflow is under one prefix, so it can be listed or
  deleted together, and deleting one workflow's data never breaks another
  workflow. Data is not shared across workflows on purpose.
- The namespace and workflow ID come from the serialization context that
  Temporal SDKs pass to codecs (TypeScript SDK 1.24 and later). Payloads
  without a context use `_` for the missing parts.

An upload always writes the object, also when it exists, so its age starts
again and lifecycle rules (below) count from the last use.

### Usage in a worker

```sh
yarn add @kwkevinchan/temporal-workflow-kit @aws-sdk/client-s3
```

```ts
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createS3DataConverter } from '@kwkevinchan/temporal-workflow-kit/s3';

const dataConverter = createS3DataConverter({
  store: {
    endpoint: process.env.S3_ENDPOINT, // leave out for AWS S3
    bucket: 'temporal-payloads',
    region: 'us-east-1',
    forcePathStyle: true, // most self-hosted services
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  },
  thresholdBytes: 128 * 1024,
});

const worker = await Worker.create({
  connection: await NativeConnection.connect({ address }),
  taskQueue: 'reports',
  workflowsPath: require.resolve('./workflows'),
  activities,
  dataConverter,
});

// Clients that start workflows or read results need the same codec.
const client = new Client({
  connection: await Connection.connect({ address }),
  dataConverter,
});
```

Every value comes from the options; the package does not read AWS
environment variables or profiles. To use the default AWS credential chain
(for example an IAM role), create an `S3Client` yourself and pass it as
`store.client`.

Other codecs: `createS3DataConverter({ store, codecs: [compression] })` runs
them first. Temporal encodes with the codecs in order and decodes in the
reverse order, so the S3 codec stores what the others produced. Encrypted
data is stored encrypted; Backstage then shows its size but no preview.

Lower level: `new S3PayloadCodec(options)` and `new S3PayloadStore(options)`.

### Security

- **Bucket access.** Workers need `s3:PutObject` and `s3:GetObject` on the
  prefix; Backstage needs `s3:GetObject` only. Keep the bucket private (no
  public read, no anonymous listing). Payloads often hold the same data as
  the workflow history, so give the bucket the same protection as the
  Temporal database (encryption at rest, access logs).
- **Integrity.** `decode` checks size and SHA-256, so data changed in the
  bucket is not used. The claim check itself lives in the history and is
  trusted like the rest of the history.
- **Credentials** are options of your code. Read them from a secret store or
  the environment; never commit them.

### Cleanup

The codec never deletes objects: Temporal does not tell it when a history is
deleted. Add a lifecycle rule that expires objects under the prefix some
time after the namespace's retention period, for example retention plus 7
days:

```json
{
  "Rules": [
    {
      "ID": "expire-temporal-payloads",
      "Filter": { "Prefix": "temporal-payloads/" },
      "Status": "Enabled",
      "Expiration": { "Days": 37 }
    }
  ]
}
```

Running workflows that last longer than that need a longer expiry: an
object is uploaded once when the payload is written. Because uploads
overwrite, data that a workflow writes again gets a new age.

### Local development with RustFS

```sh
PAYLOAD_S3_ACCESS_KEY=dev-access PAYLOAD_S3_SECRET_KEY=dev-secret-key \
  docker compose -f examples/docker-compose.rustfs.yaml up -d
```

RustFS listens on `http://localhost:9100` (path-style). See the
[example worker](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/packages/example-worker/README.md) for a workflow with
large outputs.

## `/loop`: loops of AI workflows

Loop markers for Temporal workflows. AI workflows often run a loop:
generate, check, and revise when the check fails, for many rounds and
sometimes across several continue-as-new runs. This package marks every
activity and child workflow of a round with the loop name, the round and the
step, keeps the state of each loop in a query and in the memo, and carries
the round count into the next run when the workflow continues as new.

The [Backstage Temporal plugin](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal/README.md) reads the markers: the
step graph shows a loop as one box (`draft-review · Round 4 of 5 · Done`)
that expands to the steps of one round, and the Loops tab lists every round
with its steps, decision and score, across the runs.

`/loop` runs inside workflow code (the workflow sandbox).
`@temporalio/workflow` (1.12 or later; tested with 1.24) is a peer
dependency, so your workflow's own SDK is used.

### Installation

In the package with your workflow code:

```sh
yarn add @kwkevinchan/temporal-workflow-kit
```

### Usage

```ts
import { createLoops } from '@kwkevinchan/temporal-workflow-kit/loop';
import type * as activities from './activities';

export async function draftReviewWorkflow(request: { topic: string }) {
  // Once per workflow: registers the `__loop_state` query, and continues
  // the round count in a run that continued as new.
  const loops = createLoops();
  let feedback: string | undefined;

  const result = await loops.run<string>(
    'draft-review',
    { maxIterations: 5 },
    async round => {
      // Like proxyActivities; each call carries the loop marker.
      const { llmDraft, llmReview } = round.activities<typeof activities>({
        startToCloseTimeout: '1 minute',
      });
      const draft = await llmDraft({ topic: request.topic, feedback });
      const review = await llmReview({ draft });
      feedback = review.feedback;
      return review.score >= 0.8
        ? round.done({ value: draft, decision: 'accept', score: review.score })
        : round.next({ value: draft, decision: 'revise', score: review.score });
    },
  );
  // result: { status: 'done' | 'exhausted', iterations, value, decision, score }
  return result;
}
```

- `round.done(...)` ends the loop (`done`). `round.next(...)` (or returning
  nothing) starts the next round; after `maxIterations` rounds the loop is
  `exhausted` and returns the value of the last round. A round that throws
  marks the loop `failed` and the error is thrown on.
- `decision` and `score` are yours: any text and any number. Backstage shows
  them per round. `round.record({ decision, score })` sets them before the
  round ends.
- `round.activityOptions(step, options)` returns activity options with the
  marker, for your own `proxyActivities` (call it once per activity call).
- `round.executeChild(workflow, options)` starts a child workflow with the
  marker; `round.childOptions(step, options)` returns the options.
- Timers, signals and other steps without a marker that start during a round
  are shown in that round.

#### Long loops: continue-as-new

```ts
const loops = createLoops();
await loops.run(
  'refine',
  {
    maxIterations: 25,
    // After 10 rounds in one run (or when Temporal suggests it).
    continueAsNew: { afterRounds: 10, whenSuggested: true, args: [request] },
  },
  async round => {
    /* ... */
  },
);
```

The loop state goes into the memo of the next run, and `createLoops()` in
that run continues with round 11. `loops.continueAsNew(args, options)` does
the same for a continue-as-new of your own. A loop that ended in an earlier
run returns its result without running again (without `value`, which is not
carried). You can also pass the state in the workflow input:
`createLoops({ resume: input.loops })` with `loops.snapshot()`.

### Marker format (specification)

Workflows in other SDKs (Go, Python, Java, .NET) can follow this format by
hand; Backstage reads it the same way.

#### Activity marker: the activity ID

```
loop/<loop>/<iteration>/<step>[/<occurrence>]
```

- `<loop>`: name of the loop, unique in the workflow.
- `<iteration>`: the round, an integer from 1, counted across continue-as-new
  runs (round 11 is the first round of the second run when the first run
  had 10).
- `<step>`: name of the step, usually the activity type.
- `<occurrence>`: only for the second and later calls of the same step in the
  same round: `2`, `3`, ... (activity IDs must be unique among the open
  activities of a run).
- `<loop>` and `<step>` are percent-encoded like `encodeURIComponent`
  (Go: `url.PathEscape`; Python: `urllib.parse.quote(s, safe='')`), so they
  may contain `/` and any other character.

Examples: `loop/draft-review/3/llmDraft`, `loop/draft-review/3/llmDraft/2`,
`loop/my%20loop/1/check`.

The activity ID was chosen because it is the most robust place:

- every SDK can set it (`activityId`, Go `ActivityOptions.ActivityID`, Python
  `activity_id`);
- it is plain text in the `ActivityTaskScheduled` event: a payload codec
  (encryption, the S3 claim check) never changes it, so Backstage reads it
  without the codec;
- it needs no interceptor and no server feature.

The activity summary (user metadata) is set too
(`draft-review · round 3 · llmDraft`) so the Temporal UI shows the round,
but it is a payload (encoded by the codec) and is not read by Backstage.

#### Child workflow marker

A child workflow carries the marker in its memo under `temporal.loop`:

```json
{ "loop": "draft-review", "iteration": 3, "step": "reviewWorkflow" }
```

and, when you do not give a workflow ID, its ID is
`<parent workflow ID>/loop/<loop>/<iteration>/<step>[/<occurrence>]`.
Backstage reads either (the ID also works with an encrypting codec).

#### Loop state: memo `temporal.loops` and query `__loop_state`

After each round the workflow upserts the memo key `temporal.loops`; the
history keeps every upsert, so the decisions of ended runs can be read back.
The query `__loop_state` returns the same object with the rounds of the
current run (at most 500 per loop).

```json
{
  "v": 1,
  "segment": 2,
  "loops": [
    {
      "name": "draft-review",
      "iteration": 3,
      "maxIterations": 5,
      "status": "running",
      "decision": "revise",
      "score": 0.62,
      "rounds": [
        {
          "iteration": 3,
          "segment": 2,
          "status": "running",
          "startTime": "2026-11-02T08:00:00.000Z"
        }
      ]
    }
  ],
  "last": {
    "loop": "draft-review",
    "iteration": 2,
    "segment": 2,
    "status": "completed",
    "decision": "revise",
    "score": 0.62
  }
}
```

- `status` of a loop: `running`, `done` (a round decided the result is good
  enough), `exhausted` (the last allowed round ended), `failed`.
- `status` of a round: `running`, `completed`, `failed`.
- `segment`: the run, from 1; continue-as-new adds one.
- `last` (memo only): the round that ended with this upsert.
- `rounds` (query only): rounds of the current run.

The memo and query are optional: with markers alone, Backstage shows the
loops and rounds, without the limit, decisions and scores. Memo values and
query results encoded by a codec cannot be read by the backend; markers in
activity IDs always can.

#### Other SDKs, in short

Go:

```go
ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
    ActivityID:          fmt.Sprintf("loop/%s/%d/%s", url.PathEscape("draft-review"), round, "llmDraft"),
    StartToCloseTimeout: time.Minute,
})
err := workflow.ExecuteActivity(ctx, LLMDraft, req).Get(ctx, &draft)
// After the round:
workflow.UpsertMemo(ctx, map[string]interface{}{"temporal.loops": state})
```

Python:

```python
draft = await workflow.execute_activity(
    llm_draft, req,
    activity_id=f"loop/{quote('draft-review', safe='')}/{round}/llm_draft",
    start_to_close_timeout=timedelta(minutes=1),
)
workflow.upsert_memo({"temporal.loops": state})
```

Register a query `__loop_state` that returns the state to show live state of
a running workflow.

### Not supported

- Local activities do not carry the marker (their ID is not in the history
  in a form Backstage reads).
- Temporal's event groups (experimental in SDK 1.24) may replace the
  activity ID marker once they are stable in every SDK and server.
