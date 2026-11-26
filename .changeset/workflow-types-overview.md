---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Split the Temporal page into two tabs. **Workflows**, the new default tab, lists the `TemporalWorkflow` entities the user can read, filtered by owner (the user's teams by default), system, lifecycle and name, with the numbers of their runs: running now, completed and failed in the last 7 days (approximate), the latest run, the mean duration of the last 50 runs and the last failure of the 7 days. **Executions** (`?tab=executions`) is the list of every workflow execution, unchanged.

The backend serves the numbers on `POST /workflow-types/overview` for up to 25 entities, with the read permission checked on all of them in one request. Each entity takes at most three visibility calls (a count grouped by status; a list of the 50 most recent runs; a list of the last failure when needed); on a server that cannot group, the refused grouped count is followed by three counts, at most six calls, with at most 4 calls in flight in each namespace, and the numbers are kept for 60 seconds. A call that Temporal rate limits gives that entity an `error` and is not retried. `TemporalApi` has `getWorkflowTypeOverview`, and `TemporalAccessService` has `loadWorkflowEntities`: implementations of these interfaces need the new method.
