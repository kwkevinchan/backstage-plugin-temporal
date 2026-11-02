# @kwkevinchan/backstage-plugin-temporal-common

Shared code of the unofficial Backstage Temporal plugin.

## Purpose

Types and constants used by the frontend, the backend and plugins that
extend them, for example in a permission policy.

## Installation

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-temporal-common
```

## API

- Permissions: `temporalWorkflowReadPermission`
  (`temporal.workflow.read`), `.history.read`, `.list`, `.history.list`,
  and the control permissions `temporal.workflow.start`, `.signal`,
  `.update`, `.cancel`, `.terminate` and `.rerun`
  (`temporalWorkflowTerminatePermission` and so on), and
  `temporalPermissions` with all of them.
- Annotations: `TEMPORAL_NAMESPACE_ANNOTATION` (`temporal.io/namespace`),
  `TEMPORAL_TASK_QUEUE_ANNOTATION`, `TEMPORAL_WORKFLOW_TYPE_ANNOTATION`,
  `isTemporalAvailable`.
- The `TemporalWorkflow` kind: `TEMPORAL_WORKFLOW_KIND`,
  `TemporalWorkflowEntityV1alpha1`, `isTemporalWorkflowEntity`,
  `getDependsOnTemporalWorkflowRefs`.
- API types: workflow summaries and details, history, the step graph
  (`WorkflowGraphResponse`), loops (`WorkflowLoopGroup`, `parseLoopMarker`)
  and the control requests.

See [Permissions](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#permissions) in the repository README.
