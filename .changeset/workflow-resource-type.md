---
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal-node': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

`temporal.workflow.list` and `temporal.workflow.history.list` are resource
permissions on the new `temporal-workflow` resource type instead of basic
permissions. The backend registers the type (with `getResources`) and checks
them with `authorizeConditional`; conditions from rules that modules add are
turned into a Temporal visibility query for the Workflows page. The resource
ref is `temporalWorkflowPermissionResourceRef` in `-node/alpha`.
