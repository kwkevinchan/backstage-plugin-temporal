---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Answer failed calls to Temporal with fixed messages instead of what Temporal or the SDK said. The original message (addresses, visibility queries, server details) is written to the backend log with the name of the call and the namespace. An unexpected error is a `500` with the message `Internal server error`. The `error.message` of a workflow type overview item is one of three fixed texts. HTTP statuses are unchanged.
