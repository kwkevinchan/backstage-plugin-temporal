---
'@kwkevinchan/backstage-plugin-temporal-backend-module-actions': minor
---

Reject service principals by default on workflow-changing actions (`start-workflow`, `signal-workflow`, `update-workflow`). Read actions (`list-workflows`, `get-workflow`) and signed-in user callers are unchanged. After upgrading, deployments that intentionally call write actions with a service token (such as a static `backend.auth.externalAccess` token) must either switch to user tokens or set `temporal.actions.allowServiceWrites: true`.
