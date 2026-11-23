---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
---

Export `TemporalPluginClient`, `CONTROL_DISABLED_MESSAGE`, `buildWorkflowUrl`, `continuedAsNewRunIdOf` and `resolveWorkflowNamespace` from `@kwkevinchan/backstage-plugin-temporal-backend/node`, for backend modules that call the plugin on behalf of a user. The client also reads an entity's workflow list and the graph of a run. The Scaffolder actions use them; their behavior does not change.
