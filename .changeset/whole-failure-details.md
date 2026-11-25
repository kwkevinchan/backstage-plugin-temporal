---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Failures keep their details wherever a run is read: the kind, the application error type, the message, the stack trace, the cause chain and the other fields. `GET /:wf` gives the whole `failure` and the whole `lastFailure` of the pending activities, `GET /:wf/graph` the whole failures of the steps and their attempts, and `GET /:wf/result` the whole failure of the run. The `error` of a model call summary (`WorkflowLlmSummary.error`) is the error type only, or `error` when the record has no type; the message is in the record of the call.
