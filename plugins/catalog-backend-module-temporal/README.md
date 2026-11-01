# @kwkevinchan/backstage-plugin-catalog-backend-module-temporal

Unofficial catalog backend module that adds the `TemporalWorkflow` kind
(`apiVersion: temporal.io/v1alpha1`). It validates the spec with a JSON
schema and adds the relations of the entity.

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
Temporal annotations. See the [repository README](../../README.md) for an
example and for how components refer to a workflow.
