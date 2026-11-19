---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
---

Add `GET .../runs/:runId/result` (`WorkflowResultResponse`) so a run's result or failure can be read from its close event in one Temporal call. Remove `GET .../runs/:runId/steps` and the exported types `WorkflowStepsResponse` and `ActivityStep` (breaking). `temporal:workflow:wait` with `includeResult` uses the new route. The scaffolder client's `steps()` is removed. Upgrade the backend and the frontend plugin together: they only talk over HTTP, and the frontend re-exports the shared types.
