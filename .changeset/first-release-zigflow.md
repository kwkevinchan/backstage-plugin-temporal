---
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': minor
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': minor
---

First release of the Definition tab for workflows written in the Serverless
Workflow DSL and run by Zigflow. The frontend module (it needs
`@kwkevinchan/backstage-plugin-temporal-frontend`) shows, on
`TemporalWorkflow` entities with `spec.definition`, the YAML next to its
graph, selecting each other, with a run of the workflow on top; with
`format: source`, a workflow written in code shows its source with its
function marked. The backend module (a module of
`@kwkevinchan/backstage-plugin-temporal-backend`) serves the file
(`GET /api/temporal/entities/:kind/:namespace/:name/definition`), read with
the URL reader of the configured integrations, at most
`temporal.definitions.maxBytes`. Without the backend module the tab says
that the backend serves no workflow definitions. The frontend module's package
root exports `EntityTemporalDefinitionContent` for the legacy frontend system;
the new frontend system uses `./alpha`.
