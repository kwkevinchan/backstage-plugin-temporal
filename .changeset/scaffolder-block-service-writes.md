---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': minor
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Reject tasks that do not run as a user by default on `temporal:workflow:start` and `temporal:workflow:signal` (signals and updates). `temporal:workflow:wait` only reads and is unchanged. After upgrading, deployments that start tasks with a service token (such as a static `backend.auth.externalAccess` token) and change workflows from them must either run the tasks as a user or set `temporal.scaffolder.allowServiceWrites: true`. The module now has a config schema (`config.d.ts`). The `TemporalPluginClient` documentation now says it uses the credentials of the caller.
