# @kwkevinchan/backstage-plugin-temporal-common

Types, permissions, API paths, annotation constants and the `TemporalWorkflow`
entity of the unofficial [Backstage Temporal plugin](../../README.md), shared
by its frontend and backend packages.

Install it when you write a permission policy, a backend module or a frontend
module for the plugin and need its permissions or types:

```ts
import { temporalWorkflowTerminatePermission } from '@kwkevinchan/backstage-plugin-temporal-common';
```

Browser and Node: the package has no I/O and depends only on
`@backstage/catalog-model`, `@backstage/plugin-permission-common` and
`@backstage/types`.
