---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Every call to Temporal has a deadline: 10 seconds for a read and for an operation, 15 seconds for a list or a count (a schedule list with all its pages), 35 seconds for a query, and 30 seconds for an update and each of its polls. A call that misses it, a call that Temporal rate limits (`RESOURCE_EXHAUSTED`), and a connection to Temporal that cannot be opened now answer `503` instead of `500`.
