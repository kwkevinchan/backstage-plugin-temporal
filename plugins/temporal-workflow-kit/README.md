# @kwkevinchan/temporal-workflow-kit

Helpers for Temporal workers whose workflows are shown by the unofficial
[Backstage Temporal plugin](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md).
It is not a Backstage package: install it in your worker, not in Backstage.

| Entry point                               | What it is                                                                                                                                                     | Needs                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `@kwkevinchan/temporal-workflow-kit/s3`   | Payload codec: large payloads in S3-compatible storage, a claim check in the history.                                                                          | `@aws-sdk/client-s3` 3.350 or later                |
| `@kwkevinchan/temporal-workflow-kit/loop` | Loop markers, a loop state query and continue-as-new helpers. Runs in the workflow sandbox.                                                                    | `@temporalio/workflow` 1.12 or later (tested 1.24) |
| `@kwkevinchan/temporal-workflow-kit/llm`  | LLM steps: markers for model calls and tool calls, a recorder of model calls (OpenTelemetry GenAI attributes) and converters for OpenAI, Anthropic and Ollama. | Nothing (no LLM SDK)                               |

There is no root entry point; import one of the three. Both SDKs are optional
peer dependencies, so a worker installs only what it uses: a worker that
only uses `/loop` does not install the AWS SDK, and `/loop` never loads it
into the workflow bundle.

```sh
# Loops only (your worker already has @temporalio/workflow):
yarn add @kwkevinchan/temporal-workflow-kit
# Large payloads in S3:
yarn add @kwkevinchan/temporal-workflow-kit @aws-sdk/client-s3
```

The Backstage backend reads the claim checks, markers and records with its
own code and does not need this package. Both implementations are tested
against the same examples (`test-fixtures/claim-checks.json`,
`test-fixtures/loop-markers.json` and `test-fixtures/llm-records.json` in
the repository).

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
that expands to every round of the run, one frame per round, and the Loops
tab lists every round
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

## `/llm`: LLM steps of agent workflows

Marks the activities of an LLM agent and records each model call, so the
[Backstage Temporal plugin](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#llm-steps)
shows every call with its input, reasoning, output, tool calls and tokens,
and draws the tools a call asked for next to it.

- **Model call**: an activity that calls the model and returns the record
  of the call (`recordLlmCall`). Its activity ID starts with
  `llm/<call>`.
- **Tool call**: the model asked for a tool; the workflow runs it as an
  activity whose ID starts with `tool/<call>/<tool call ID>`, or as a local
  activity whose result carries the same marker. Tools can also run inside
  the model call's activity; they are then only in the record.

The record follows the
[OpenTelemetry semantic conventions for generative AI](https://github.com/open-telemetry/semantic-conventions-genai)
(attributes `gen_ai.*`, message parts `text`, `reasoning`, `tool_call`,
`tool_call_response`, ...), version **`gen-ai-dev/1.42.0-dev`**
(repository `open-telemetry/semantic-conventions-genai` at commit
`16f3130`, 2 November 2026). The conventions are still in Development;
the record names the version it follows (`semconv`), and a new version of
this package will move to a newer one.

No LLM SDK is used: the converters only read the shape of the requests and
responses, so any client library (or plain `fetch`) works. Everything runs
in the workflow sandbox too; the workflow needs only the markers and
`toolCallsOf`.

### Usage

Activity (any client library; here the OpenAI SDK):

```ts
import OpenAI from 'openai';
import {
  openaiChat,
  recordLlmCall,
} from '@kwkevinchan/temporal-workflow-kit/llm';

const openai = new OpenAI();

export async function callModel(request: { messages: any[] }) {
  return recordLlmCall({
    request: { model: 'gpt-4.1', messages: request.messages, tools: TOOLS },
    convert: openaiChat, // or anthropicMessages, ollamaChat
    call: body => openai.chat.completions.create(body),
    // Optional: keep the result small, the record has the output.
    value: () => undefined,
  });
}
```

Workflow:

```ts
import { proxyActivities } from '@temporalio/workflow';
import {
  llmCallOptions,
  toolCallOptions,
  toolCallsOf,
} from '@kwkevinchan/temporal-workflow-kit/llm';
import type * as activities from './activities';

export async function agentWorkflow(question: string) {
  const messages: any[] = [{ role: 'user', content: question }];
  for (let turn = 1; turn <= 10; turn++) {
    const call = `agent-${turn}`; // unique in the run
    const { callModel } = proxyActivities<typeof activities>(
      llmCallOptions(call, { startToCloseTimeout: '2 minutes' }),
    );
    const result = await callModel({ messages });
    const toolCalls = toolCallsOf(result);
    if (toolCalls.length === 0) return result;
    messages.push(/* the assistant message with its tool calls */);
    // Each tool call as its own activity, linked to the model call.
    const outputs = await Promise.all(
      toolCalls.map(tc =>
        proxyActivities<typeof activities>(
          toolCallOptions(call, tc.id!, { startToCloseTimeout: '1 minute' }),
        )[tc.name as 'search'](tc.arguments as any),
      ),
    );
    messages.push(/* one tool message per output */);
  }
}
```

- `llmCallOptions(call, options)` and `toolCallOptions(call, toolCallId,
options)` return activity options with the marker. Use them for one call
  each (an activity ID must be unique among the open activities).
- With [loops](#loop-loops-of-ai-workflows), pass the options of a round:
  `llmCallOptions(call, round.activityOptions('callModel', options))` gives
  `llm/<call>/loop/<loop>/<round>/callModel`, so the call shows in the
  round and the Loops tab adds up the tokens of each round.
- Local activities: Backstage cannot read their activity ID in every SDK
  (TypeScript uses a sequence number), so return
  `markToolResult({ call, toolCallId }, value)` from the activity and
  unwrap it in the workflow with `toolValueOf(result)`.
- Tools inside the model call's activity: `call: (body, context) => ...`
  gets `context.runTool({ id, name, arguments }, run)`, which records the
  tool (`execute_tool` attributes) in the record's `toolExecutions`.
- Failed calls: `recordLlmCall` throws the error with the record in its
  `llm` property. To keep the record in the history, return a failure with
  the record as details:
  `onError: (err, record) => ApplicationFailure.fromError(err, { details: [record] })`
  (`ApplicationFailure` from `@temporalio/activity`). Backstage reads it
  from the failure details.
- `toolCallsOf(result)`, `outputTextOf(result)` and `reasoningOf(result)`
  read the output; `createLlmRecord(attributes, extra)` builds a record
  from attributes you collected yourself.

### Format (specification)

Workflows in other SDKs follow this format by hand; Backstage reads it the
same way.

#### Activity IDs

```
llm/<call>[/<rest>]
tool/<call>/<toolCallId>[/<rest>]
```

- `<call>`: name of the model call, unique within the run, for example
  `agent-3` or `r2`. Not `loop`.
- `<toolCallId>`: the ID the model gave the tool call (OpenAI `call_...`,
  Anthropic `toolu_...`). The Ollama converter uses `call_<n>` (position in
  the message, from 1) when Ollama gives none.
- `<rest>`: anything, for example a loop marker
  (`loop/<loop>/<round>/<step>`) or a number that keeps IDs unique.
- `<call>` and `<toolCallId>` are percent-encoded like `encodeURIComponent`
  (Go `url.PathEscape`, Python `urllib.parse.quote(s, safe='')`).

The activity ID is used for the same reasons as for loops: every SDK can
set it, and a payload codec (encryption, S3) never changes it, so Backstage
finds the LLM steps without the codec. Tool calls are linked to the latest
model call with the same `<call>` that started before them.

A tool run as a local activity returns
`{ "temporal.llm.tool": { "call": "<call>", "toolCallId": "<id>" }, "value": ... }`
instead (or sets the activity ID, in SDKs that let it).

#### The record: the result of the model call

The model call activity returns an object with the record under
`temporal.llm`. Anything else in the result (`value` here) is yours; the
backend does not read it.

```json
{
  "temporal.llm": {
    "v": 1,
    "semconv": "gen-ai-dev/1.42.0-dev",
    "startTime": "2026-11-03T08:00:00.000Z",
    "durationMs": 1520,
    "attributes": {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-4.1",
      "gen_ai.request.temperature": 0.2,
      "gen_ai.response.model": "gpt-4.1-2025-04-14",
      "gen_ai.response.id": "chatcmpl-123",
      "gen_ai.response.finish_reasons": ["tool_call"],
      "gen_ai.usage.input_tokens": 812,
      "gen_ai.usage.output_tokens": 164,
      "gen_ai.usage.reasoning.output_tokens": 96,
      "gen_ai.usage.cache_read.input_tokens": 256,
      "gen_ai.system_instructions": [
        { "type": "text", "content": "You are a release assistant." }
      ],
      "gen_ai.input.messages": [
        {
          "role": "user",
          "parts": [{ "type": "text", "content": "Summarize the issues." }]
        }
      ],
      "gen_ai.output.messages": [
        {
          "role": "assistant",
          "parts": [
            { "type": "reasoning", "content": "Two issues match..." },
            { "type": "text", "content": "Reading both issues." },
            {
              "type": "tool_call",
              "id": "call_b1",
              "name": "read_issue",
              "arguments": { "id": "#12" }
            }
          ]
        }
      ],
      "gen_ai.tool.definitions": [
        { "type": "function", "name": "read_issue", "parameters": {} }
      ]
    },
    "toolExecutions": [
      {
        "gen_ai.tool.call.id": "ctx_1",
        "gen_ai.tool.name": "user_profile",
        "gen_ai.tool.call.arguments": { "user": "guest" },
        "gen_ai.tool.call.result": { "role": "developer" },
        "durationMs": 80
      }
    ]
  },
  "value": "anything"
}
```

- `v`: format version, `1`. `semconv`: the version of the conventions of
  `attributes`.
- `attributes`: attributes of the OpenTelemetry inference span of the call.
  Any `gen_ai.*` attribute may be added (for example
  `gen_ai.conversation.id`). Messages, instructions and tool definitions are
  JSON arrays; a JSON string with the array (as span exporters write it) is
  read too.
- Message parts: `text` (`content`), `reasoning` (`content`), `tool_call`
  (`id`, `name`, `arguments`), `tool_call_response` (`id`, `response`),
  `blob`, `uri`, `file`, `server_tool_call`, `server_tool_call_response`,
  and provider parts named `<provider>.<type>` (for example
  `anthropic.redacted_thinking`). System messages that are part of the chat
  history stay in `gen_ai.input.messages`; instructions given apart
  (Anthropic `system`) are `gen_ai.system_instructions`.
- Input tokens include cached tokens, output tokens include reasoning
  tokens (as the conventions ask).
- `error`: `{ "type", "message" }` of a failed call; `error.type` is set in
  the attributes too.
- `toolExecutions`: tools that ran inside the activity, with the attributes
  of an `execute_tool` span (`gen_ai.tool.call.id`, `gen_ai.tool.name`,
  `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, `error.type`),
  and `error` and `durationMs`.

#### Large records

A record is part of the activity result, so the
[S3 codec](#s3-large-payloads-in-s3) stores a large one in S3 like any other
payload. The step graph shows the model, tokens and tools of records up to
the backend's inline limit (`maxInlineBytes`, 256 KiB by default); the step
panel reads records up to 8 MiB from S3. Records encrypted by a codec are
found (the activity ID marks them) but not shown.

#### What Backstage shows, and the permissions

- Step graph, Loops tab and Timeline (the read permission): the model,
  token counts, duration, the number and names of the tools and whether
  there is reasoning. These are names and numbers, like step names.
- The step panel of a model call (`temporal.workflow.history.read`, like
  inputs and results): the messages, the reasoning, the output, tool
  arguments and results, and the raw record.

### Other SDKs, in short

Go:

```go
// The model call.
ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
    ActivityID:          "llm/" + url.PathEscape(call),
    StartToCloseTimeout: 2 * time.Minute,
})
var result struct {
    Record map[string]any `json:"temporal.llm"`
}
err := workflow.ExecuteActivity(ctx, CallModel, req).Get(ctx, &result)

// In the activity: return the record.
return map[string]any{
    "temporal.llm": map[string]any{
        "v": 1, "semconv": "gen-ai-dev/1.42.0-dev",
        "durationMs": time.Since(start).Milliseconds(),
        "attributes": map[string]any{
            "gen_ai.operation.name":      "chat",
            "gen_ai.provider.name":       "openai",
            "gen_ai.request.model":       req.Model,
            "gen_ai.usage.input_tokens":  resp.Usage.PromptTokens,
            "gen_ai.usage.output_tokens": resp.Usage.CompletionTokens,
            "gen_ai.input.messages":      inputMessages,  // []map[string]any with role and parts
            "gen_ai.output.messages":     outputMessages,
        },
    },
}, nil

// Each tool call.
ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
    ActivityID:          "tool/" + url.PathEscape(call) + "/" + url.PathEscape(toolCallID),
    StartToCloseTimeout: time.Minute,
})
```

Python:

```python
from urllib.parse import quote

result = await workflow.execute_activity(
    call_model, req,
    activity_id=f"llm/{quote(call, safe='')}",
    start_to_close_timeout=timedelta(minutes=2),
)
for tc in tool_calls(result["temporal.llm"]):
    await workflow.execute_activity(
        TOOLS[tc["name"]], tc["arguments"],
        activity_id=f"tool/{quote(call, safe='')}/{quote(tc['id'], safe='')}",
        start_to_close_timeout=timedelta(minutes=1),
    )

# In the activity:
return {
    "temporal.llm": {
        "v": 1,
        "semconv": "gen-ai-dev/1.42.0-dev",
        "durationMs": round((time.monotonic() - start) * 1000),
        "attributes": {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "anthropic",
            "gen_ai.request.model": req["model"],
            "gen_ai.usage.input_tokens": usage.input_tokens,
            "gen_ai.usage.output_tokens": usage.output_tokens,
            "gen_ai.input.messages": input_messages,
            "gen_ai.output.messages": output_messages,
        },
    }
}
```

Python local activities can set `activity_id` too
(`workflow.execute_local_activity(..., activity_id="tool/...")`).

### Not supported

- Streamed responses: collect the stream into the response shape first.
- Child workflows as tools are shown as child workflows, not linked to the
  model call.
