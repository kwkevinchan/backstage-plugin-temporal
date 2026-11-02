---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

First release of the backend plugin.

- Permission-checked routes for the workflows of an entity and of the
  Workflows page: lists, details, the step graph, progress, loops, the event
  history and downloads of payloads stored in S3 (`temporal.payloads.s3`,
  read with the claim checks of `@kwkevinchan/temporal-workflow-kit/s3`).
- LLM steps: model calls (activity ID `llm/...`) and their tool calls
  (`tool/...`) are found without the payload codec; the graph, the steps
  and the loops carry a summary of each call (model, tokens, duration,
  tools, reasoning), and `GET .../llm-calls/:eventId` returns the full
  record (OpenTelemetry GenAI attributes), also from S3, with the history
  permission.
- Controls (start, signal, update, query, cancel, terminate, rerun),
  recorded with the auditor and limited with `temporal.control`.
- The shared Temporal client service (`temporalServiceRef`, with bearer
  token authentication) and `temporalExtensionPoint` for enrichers and
  custom control actions of backend modules.
- The permissions (`temporalPermissions`), the types and the annotation
  constants of the plugin, for permission policies and modules.
