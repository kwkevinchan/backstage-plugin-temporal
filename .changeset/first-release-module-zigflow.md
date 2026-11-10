---
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': minor
---

First release of the Definition tab for workflows written in the Serverless
Workflow DSL and run by Zigflow: on `TemporalWorkflow` entities with
`spec.definition`, the YAML next to its graph, selecting each other, with a
run of the workflow on top (done, running, failed, not reached). Workflows
written in code get links to their source. It needs the Temporal plugin
(`@kwkevinchan/backstage-plugin-temporal`) and the backend module
`@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow`.
- `spec.definition.format: source` shows the source code of a workflow written
  in code, with its function (`symbol`, else the workflow type) marked.
The YAML and the graph can go full screen together.
