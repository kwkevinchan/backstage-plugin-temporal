---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Create auditor events before authorization and request validation checks on workflow operations, queries, and schedule operations so denied attempts are recorded via `event.fail`.
