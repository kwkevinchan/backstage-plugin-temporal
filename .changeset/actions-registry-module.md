---
'@kwkevinchan/backstage-plugin-temporal-backend-module-actions': minor
---

Add a backend module that registers Temporal actions in the Backstage actions registry: `list-workflows`, `get-workflow`, `start-workflow`, `signal-workflow` and `update-workflow`. AI assistants and MCP clients call them as the caller, with the permission checks and audit records of the workflow pages; a caller that authenticates as a service runs them as that service, without the permission policy of a user. Actions that change workflows are not `readOnly`, so a caller can ask a person first.
