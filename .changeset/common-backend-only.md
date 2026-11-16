---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

`./common` no longer exports `isValidControlActionId` and
`MAX_CONTROL_NAME_LENGTH` (only the backend uses them) and the request types
`WorkflowTerminateRequest` and `WorkflowRerunRequest`, which no route or
client used.
