---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

The controls are more reliable:

- Start workflow asks for a **Task queue** when the `TemporalWorkflow` entity does not name one (the start answered 400 before), and sends the workflow type and task queue it asks for when the source of the entity cannot be read.
- An update takes an optional `updateId` (`WorkflowUpdateRequest`). The dialog keeps the same ID while a failed update is sent again with the same name and arguments, so a retry after a timeout does not run a second update. The poll of an unfinished update answers 409, like the update call, when the chain has ended.
- Rerun does not copy the search attributes Temporal sets itself (`Temporal...`), and a generated workflow ID stays within 1,000 characters.
- The tooltip of a disabled schedule button names the schedule ("You do not have permission to run this schedule"). The three disabled-with-reason buttons share one component.
- The result of a signal or an update is cleared when its name changes in the dialog.
- Pause and resume of a schedule take an optional reason, sent as the `note`.
- **Breaking:** `TemporalControlActionButtonOptions` no longer has `body`; a custom action button sends no body.
