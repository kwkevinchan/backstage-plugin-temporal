---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': minor
---

First release of the backend module for Zigflow workflows: it serves the
definition file of a `TemporalWorkflow` entity
(`GET /api/temporal/entities/:kind/:namespace/:name/definition`), read with
the URL reader of the configured integrations, at most
`temporal.definitions.maxBytes` (1 MiB), parsed as plain YAML with a limit
on aliases, with the lines of each task.
