---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
---

Add `GET .../runs/:runId/result` (`WorkflowResultResponse`) so a run's result or failure can be read from its close event in one Temporal call. `temporal:workflow:wait` with `includeResult` uses this route.
