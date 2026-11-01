# example-worker

Development only, never published. Starts three example workflows on the
`backstage-example` task queue, matching the `example-orders` component in
`examples/entities.yaml`:

| Workflow             | Result                                  |
| -------------------- | --------------------------------------- |
| `orderWorkflow`      | Completes                               |
| `paymentWorkflow`    | Fails, with a cause chain               |
| `deploymentWorkflow` | Keeps running, with a retrying activity |

```sh
yarn workspace example-worker start
```

The worker stops when the first two workflows are closed; the third one stays
running. Environment variables: `TEMPORAL_ADDRESS` (default `localhost:7233`),
`TEMPORAL_NAMESPACE` (default `default`), `ENTITY_REF_ATTRIBUTE` (default
`BackstageEntityRef`, empty to skip the search attribute).
