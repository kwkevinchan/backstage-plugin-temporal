---
'@kwkevinchan/backstage-plugin-temporal-backend-module-actions': minor
---

Add a backend module that registers Temporal actions in the Backstage actions registry: `list-workflows`, `get-workflow`, `start-workflow`, `signal-workflow` and `update-workflow`. AI assistants and MCP clients call them as the signed-in user, with the permission checks and audit records of the workflow pages. Actions that change workflows are not `readOnly`, so a caller can ask a person first.
