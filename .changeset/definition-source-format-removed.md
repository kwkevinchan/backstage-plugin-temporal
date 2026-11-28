---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': minor
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': minor
---

**Breaking:** the `source` format of `spec.definition` is removed. A `TemporalWorkflow` entity can only use `format: serverless-workflow`; an entity with `format: source` or with `spec.definition.symbol` no longer passes the kind validation. Remove both fields. Workflows written in code keep the links to their source from `backstage.io/source-location` and `backstage.io/view-url` that the Definition tab shows without `spec.definition`.

**Breaking:** the response of `GET /entities/:kind/:namespace/:name/definition` no longer has `entityRef`, `maxBytes`, `language`, `symbol` and `symbolLines`, `column` in `error`, and `name` in `tasks`. The Definition tab never read them. `TEMPORAL_DEFINITION_FORMATS`, `TemporalDefinitionFormat` and `TemporalWorkflowDefinitionSpec` of `./common` only have `serverless-workflow`, and `TemporalWorkflowDefinitionSpec` has no `symbol`. The frontend module no longer depends on `@codemirror/lang-javascript` and `@codemirror/lang-python`.

**Breaking:** the Definition tab shows a run only for a link with both `workflowId` and `runId`. A link with only `workflowId` shows no run.
