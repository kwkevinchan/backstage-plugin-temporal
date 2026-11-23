---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
---

Export `TemporalPluginClient`, `buildWorkflowUrl`, `continuedAsNewRunIdOf` and `resolveWorkflowNamespace` from `@kwkevinchan/backstage-plugin-temporal-backend/node`, for backend modules that call the plugin on behalf of a user. The client also reads an entity's workflow list and the graph of a run. The Scaffolder actions use them. The Scaffolder actions behave as before, but two error messages are worded without "template" now, because the client is shared: the message when `temporal.control.enabled` is false in the Temporal backend (it still names that key), and the message for a refused token (it says "the user" instead of "the user who runs the template").
