---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

Failure details belong to the history level. A caller with the read level sees the kind, the application error type and the message of the outermost failure; the stack trace, the cause chain and the other fields of a failure need the history permission, like inputs and results.

- `temporal-backend`: without the history permission, `GET /:wf` keeps only `message`, `kind` and `type` of `failure` and of the `lastFailure` of the pending activities, and sets the new `WorkflowDetail.failureDetailsHidden`. `GET /:wf/graph` does the same for the failures of the steps and their attempts when `payloadsHidden` is true. `GET /:wf/result` (history level) still gives the whole failure. The `error` of a model call summary (`WorkflowLlmSummary.error`) is the error type only, or `error` when the record has no type.
- `temporal-frontend`: the failure views say that the stack trace and the causes need the permission to read the event history when the backend left them out.
