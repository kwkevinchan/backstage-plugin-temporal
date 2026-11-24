---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

Support `workflowIdReusePolicy` (`ALLOW_DUPLICATE`, `ALLOW_DUPLICATE_FAILED_ONLY`, `REJECT_DUPLICATE`) on the Temporal backend workflow start API and have `temporal:workflow:start` pass `REJECT_DUPLICATE` with a clear conflict message when starting with a default workflow ID.
