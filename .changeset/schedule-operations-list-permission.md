---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Schedule operations (pause, unpause, trigger) without `entityRef` now also need `temporal.workflow.list` without conditions, as starting a workflow from the Temporal page does. A caller whose list permission is conditional gets 403. A custom action ID that is not registered still answers 404, and is now recorded as a failed `workflow-action` audit event.
