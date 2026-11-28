---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

The statistics card of a `TemporalWorkflow` entity shows the same numbers as the Workflows tab of the Temporal page: runs running now, runs completed and failed in the last 7 days, and the mean duration of the most recent runs. Its Refresh button reads the numbers from Temporal again.

Breaking changes:

- Backend: the route `GET /entities/:kind/:namespace/:name/workflow-stats` is removed, with `WorkflowStatsResponse` and `buildEntityWorkflowStatsPath` of the `./common` entry point. Use `POST /workflow-types/overview` (`WorkflowTypeOverviewResponse`). The request has a new optional `refresh` field: `true` reads the numbers again instead of using the ones kept for 60 seconds; the reads still wait for the rate limit of the overview.
- Frontend: `TemporalApi.getEntityWorkflowStats` and `TemporalClient.getEntityWorkflowStats` are removed. `getWorkflowTypeOverview` takes `{ refresh?: boolean }` as a second argument.
