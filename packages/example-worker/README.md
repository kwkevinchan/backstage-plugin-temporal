# example-worker

Development only, never published. Starts example workflows on the
`backstage-example` task queue, matching the entities in
`examples/entities.yaml`:

| Workflow             | Runs | Result                                  | Shown on                                                         |
| -------------------- | ---- | --------------------------------------- | ---------------------------------------------------------------- |
| `orderWorkflow`      | 2    | Completes                               | `example-orders`, `example-order-workflow`, `example-checkout`   |
| `paymentWorkflow`    | 1    | Fails, with a cause chain               | `example-orders`, `example-payment-workflow`, `example-checkout` |
| `deploymentWorkflow` | 1    | Keeps running, with a retrying activity | `example-orders`, `example-checkout`                             |

`example-order-workflow` and `example-payment-workflow` are `TemporalWorkflow`
entities; `example-checkout` lists them in `spec.dependsOn`.

```sh
yarn workspace example-worker start
```

The worker stops when the order and payment workflows are closed; the
deployment workflow stays running. Environment variables: `TEMPORAL_ADDRESS`
(default `localhost:7233`), `TEMPORAL_NAMESPACE` (default `default`),
`ENTITY_REF_ATTRIBUTE` (default `BackstageEntityRef`, empty to skip the search
attribute).
