---
'@kwkevinchan/backstage-plugin-temporal-backend-module-control': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-node': minor
'@kwkevinchan/backstage-plugin-temporal-common': minor
---

The routes that change workflows (start, signal, update, cancel, terminate,
rerun, custom actions) move to the new control module; without it the
backend plugin only reads. `temporal.control.enabled` is removed (leave the
module out instead); `allowedSignals` and `allowedUpdates` are read by the
module. Custom actions are added with `temporalControlExtensionPoint` from
`-node/alpha`; `temporalExtensionPoint` keeps `addWorkflowEnricher` only.
Query stays in the core plugin and needs the new `temporal.workflow.query`
permission; the new `GET .../handlers` lists the signals, updates and
queries of a workflow with the read permission.
