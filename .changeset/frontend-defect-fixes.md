---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

Fix several defects in the frontend:

- The Workflows tab no longer sorts by the latest run, which loaded every row first and stopped working above 50 workflows. It lists the workflows by name, one catalog page at a time. A failed request of numbers keeps its error and gives each row a retry button instead of showing made-up numbers.
- The pending activities table shows the time of the last heartbeat.
- The Progress column of a workflow list loads again when the list is refreshed or its run changes, and offers a retry button when it fails.
- The copy button shows the check mark only when the text was copied.
- A `file` part of a model call shows its name or ID and MIME type instead of `file undefined`.
- `TemporalApi.listSchedules` and `TemporalClient.listSchedules` no longer take the unused `namespace` option.
