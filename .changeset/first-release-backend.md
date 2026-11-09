---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

First release of the backend plugin.

- Permission-checked routes for the workflows of an entity and of the
  Workflows page: lists, details, the step graph, progress, loops, the event
  history and downloads of large payloads in Temporal External Storage
  (`temporal.externalStorage.s3`: the references of the SDKs' S3 driver,
  read and verified by the backend itself).
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
- Graph steps carry the summary of their event (Temporal user metadata).
