---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

When an entity depends on more than 20 TemporalWorkflow entities, the merged
execution list includes only the first 20 types (in the order of their entity
references) and says so, with the total. Open a type in Workflow types to see
the rest. The list and statistics responses carry `relatedWorkflows` (`total`,
`queried`).
