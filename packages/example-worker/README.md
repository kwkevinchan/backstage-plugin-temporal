# example-worker

Development only, never published. Starts example workflows on the
`backstage-example` task queue, matching the entities in
`examples/entities.yaml`:

| Workflow              | Runs | Result                                                                                                             | Shown on                                                         |
| --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `orderWorkflow`       | 2    | Completes                                                                                                          | `example-orders`, `example-order-workflow`, `example-checkout`   |
| `paymentWorkflow`     | 1    | Fails, with a cause chain                                                                                          | `example-orders`, `example-payment-workflow`, `example-checkout` |
| `deploymentWorkflow`  | 1    | Keeps running, with a retrying activity                                                                            | `example-orders`, `example-checkout`                             |
| `fulfillmentWorkflow` | 1    | Completes: parallel activities, an activity retried twice, a timer and a child workflow (`notifyCustomerWorkflow`) | `example-orders`                                                 |
| `approvalWorkflow`    | 1    | Keeps running, waiting for an `approve` update; gets one `comment` signal                                          | `example-orders`                                                 |

`example-order-workflow` and `example-payment-workflow` are `TemporalWorkflow`
entities; `example-checkout` lists them in `spec.dependsOn`.

```sh
yarn workspace example-worker start
```

The worker stops when the order, payment and fulfillment workflows are
closed; the deployment and approval workflows stay running. Environment variables: `TEMPORAL_ADDRESS`
(default `localhost:7233`), `TEMPORAL_NAMESPACE` (default `default`),
`ENTITY_REF_ATTRIBUTE` (default `BackstageEntityRef`, empty to skip the search
attribute). The approval workflow sets the `ApprovalPending` search attribute
(type `Bool`) when it is registered, so the plugin shows "Waiting for
approval"; without it the plugin shows "Waiting for an external event".
