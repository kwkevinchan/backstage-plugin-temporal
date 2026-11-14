---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

`./common` no longer exports `isValidControlActionId`, `MAX_CONTROL_NAME_LENGTH`
and `parseLoopMarker` (only the backend uses them; the loop marker types stay)
and the request types `WorkflowTerminateRequest` and `WorkflowRerunRequest`,
which no route or client used.
