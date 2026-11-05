# @kwkevinchan/backstage-plugin-catalog-backend-module-temporal

Unofficial catalog backend module for the Backstage Temporal plugin.

## Purpose

Adds the `TemporalWorkflow` kind (`apiVersion: temporal.io/v1alpha1`). One
entity stands for one Temporal Workflow Type and its Workflow Definition (the
workflow code); the module validates the spec with a JSON schema and adds
the relations of the entity.

## Installation

```sh
yarn --cwd packages/backend add @kwkevinchan/backstage-plugin-catalog-backend-module-temporal
```

```ts
backend.add(
  import('@kwkevinchan/backstage-plugin-catalog-backend-module-temporal'),
);
```

Allow the kind in the catalog rules:

```yaml
catalog:
  rules:
    - allow: [Component, System, API, Resource, Location, TemporalWorkflow]
```

## API

- Default export: the catalog module.
- `TemporalWorkflowEntityProcessor`: the processor, for custom setups.

| Field               | Required | Relations                    |
| ------------------- | -------- | ---------------------------- |
| `spec.owner`        | yes      | `ownedBy` / `ownerOf`        |
| `spec.workflowType` | yes      |                              |
| `spec.taskQueue`    | no       |                              |
| `spec.namespace`    | no       |                              |
| `spec.system`       | no       | `partOf` / `hasPart`         |
| `spec.lifecycle`    | no       |                              |
| `spec.dependsOn`    | no       | `dependsOn` / `dependencyOf` |

Names (`workflowType`, `taskQueue`, `namespace`) follow the same rules as the
Temporal annotations. See [Workflow entities](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#workflow-entities)
in the repository README for an example and for how components refer to a
workflow.
