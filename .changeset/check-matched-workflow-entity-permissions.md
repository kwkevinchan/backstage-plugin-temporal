---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

Check history-level and control permissions against both the opened entity and the matched `TemporalWorkflow` entity when a workflow is opened through a `dependsOn` relation (including child workflows), and include `workflowEntityRef` on workflow details so control buttons check permissions on both entities.
