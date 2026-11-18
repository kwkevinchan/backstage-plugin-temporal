---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

When an entity depends on more than 20 TemporalWorkflow entities, the merged
execution list and the recent-run statistics include only the first 20 types
and say so, with the total. Open a type in Workflow types to see the rest.
