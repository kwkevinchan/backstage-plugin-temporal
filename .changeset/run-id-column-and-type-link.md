---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

Link the workflow type of a run to its `TemporalWorkflow` entity in the lists and on the details page, and add a Run ID column to the workflow lists.

- New `workflowTypeEntityRef` on workflow summaries and details: the `TemporalWorkflow` entity found in the catalog by namespace, workflow type and task queue. It is only for showing a link; permission checks do not use it. `workflowEntityRef` stays for the entities a run matches through `dependsOn`, and the operations still check it.
- When several entities match, the ones with the task queue of the run win over the ones without a task queue. If more than one is left at that level, the run has no `workflowTypeEntityRef`.
- The lists show the first 8 characters of the run ID next to the workflow ID, as the Temporal UI does. Both link to the run, and the full ID is the tooltip and can be copied.
