---
'@kwkevinchan/backstage-plugin-temporal-backend-module-control': minor
---

First release of the backend control module: the routes that change
workflows (start, signal, update, cancel, terminate, rerun and custom
actions), each checked with its permission through `temporalAccessServiceRef`
and recorded with the auditor. `temporal.control.allowedSignals` and
`allowedUpdates` limit the names that may be sent. Backend modules add custom
actions with `temporalControlExtensionPoint`
(`@kwkevinchan/backstage-plugin-temporal-node/alpha`). Without this module
the plugin only reads.
`POST /namespaces/:namespace/schedules/:scheduleId/pause|unpause|trigger`
with `temporal.workflow.start` on the entity whose workflow types the
schedule starts, or without conditions without one.
