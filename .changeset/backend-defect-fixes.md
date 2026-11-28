---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

Fix several defects in the backend:

- The workflow list and the workflow detail give the same `workflowEntityRef` when a run matches both the opened entity and a `TemporalWorkflow` entity it depends on: the related entity.
- `isTemporalAvailable` ignores annotations whose value is only white space or commas, so the tab is not opened for a value the backend refuses.
- When the history of a run is cut, an event group whose steps were still open at the cut keeps the status of its steps instead of `Canceled` or `Failed`.
- The current step of a run with a failing workflow task names the latest failure, not the first.
- Reading the history for the steps asks for no more events than are left, returns at most the maximum, and stops after 100 pages of an answer that keeps returning a page token.
- The progress of a run with an unknown status is not cached.
- Listing the schedules of an entity describes at most 100 schedules (the list is marked `truncated` beyond that), and resolving permission resources describes at most 8 workflows at a time.
- A `TemporalWorkflow` entity without `spec` no longer fails reading its messages, closing the Temporal connection while it is failing does not reject, and a message name longer than 200 characters gets its own error message.
