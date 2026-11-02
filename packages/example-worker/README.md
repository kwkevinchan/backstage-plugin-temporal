# example-worker

Development only, never published. Starts example workflows on the
`backstage-example` task queue, matching the entities in
`examples/entities.yaml`:

| Workflow              | Runs | Result                                                                                                                                                                                                             | Shown on                                                         |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `orderWorkflow`       | 2    | Completes                                                                                                                                                                                                          | `example-orders`, `example-order-workflow`, `example-checkout`   |
| `paymentWorkflow`     | 1    | Fails, with a cause chain                                                                                                                                                                                          | `example-orders`, `example-payment-workflow`, `example-checkout` |
| `deploymentWorkflow`  | 1    | Keeps running, with a retrying activity                                                                                                                                                                            | `example-orders`, `example-checkout`                             |
| `fulfillmentWorkflow` | 1    | Completes: parallel activities, an activity retried twice, a timer and a child workflow (`notifyCustomerWorkflow`)                                                                                                 | `example-orders`                                                 |
| `approvalWorkflow`    | 1    | Keeps running, waiting for an `approve` update; gets one `comment` signal                                                                                                                                          | `example-orders`                                                 |
| `reportWorkflow`      | 1    | Completes with large outputs stored in S3 (only with `PAYLOAD_S3_ENDPOINT`)                                                                                                                                        | `example-orders`                                                 |
| `agentWorkflow`       | 1    | Completes: a fake LLM agent (no model), four rounds of model call and tools with loop markers; a tool fails once, one runs as a local activity; the last answer is about 170 KB (in S3 with `PAYLOAD_S3_ENDPOINT`) | `example-orders`                                                 |
| `mixedAgentWorkflow`  | 1    | Completes: ordinary activities, two model calls, two tools in parallel and a child workflow (`summarizeResultsWorkflow`)                                                                                           | `example-orders`                                                 |
| `ticketWorkflow`      | 0    | Started from Backstage; signals `addNote` and `close`, update `setPriority` (with a validator), query `state`                                                                                                      | `example-ticket-workflow`                                        |

`example-order-workflow` and `example-payment-workflow` are `TemporalWorkflow`
entities; `example-checkout` lists them in `spec.dependsOn`.

```sh
yarn workspace example-worker start
```

`yarn start` loads the TypeScript sources of the codec package with the
Backstage CLI node transform.

`zigflow` starts two runs of the YAML workflow `order-fulfillment`
(`examples/workflows`, entity `example-yaml-order-workflow`): an express order
that completes (the card is declined and refunded in the `catch`) and an
order that fails because nobody sends `paymentReceived`. Zigflow runs the
workflow on the `backstage-zigflow` task queue; this command runs the worker
of its activities on `backstage-example` until both runs are done. See the
repository README (Development) for the Zigflow container.

```sh
yarn workspace example-worker zigflow
```

`serve` runs the worker until Ctrl+C without starting workflows. Workflows
started from Backstage, signals, updates and queries need it:

```sh
yarn workspace example-worker serve
```

The worker stops when the order, payment and fulfillment workflows are
closed; the deployment and approval workflows stay running. Environment variables: `TEMPORAL_ADDRESS`
(default `localhost:7233`), `TEMPORAL_NAMESPACE` (default `default`),
`ENTITY_REF_ATTRIBUTE` (default `BackstageEntityRef`, empty to skip the search
attribute). With `PAYLOAD_S3_ENDPOINT` (and `PAYLOAD_S3_BUCKET`, default
`temporal-payloads`, `PAYLOAD_S3_ACCESS_KEY`, `PAYLOAD_S3_SECRET_KEY`), the
client and the worker use the S3 payload codec of
`@kwkevinchan/temporal-workflow-kit/s3`, the bucket is created when missing, and
`reportWorkflow` runs too: its activities return about 1 MB of JSON, 180 KiB
of JSON and a PNG chart, which are stored in S3 (see
`examples/docker-compose.rustfs.yaml` for a local RustFS). The approval workflow sets the `ApprovalPending` search attribute
(type `Bool`) when it is registered, so the plugin shows "Waiting for
approval"; without it the plugin shows "Waiting for an external event".
