---
'@kwkevinchan/backstage-plugin-temporal-common': minor
---

First release of the common package, shared by the frontend, the backend and
their modules. Permission policies import the permissions from here.

- The permissions (`temporalPermissions`), including the `temporal-workflow`
  resource type and its resource refs.
- The API types and paths, including Temporal schedules
  (`TemporalSchedule`, `TemporalScheduleListResponse`).
- The annotation constants, the `TemporalWorkflow` entity schema and
  `getTemporalWorkflowSource()`, the rule for which workflows belong to an
  entity.
- `spec.messages` of that kind (`getTemporalWorkflowMessages()`,
  `mergeWorkflowHandlers()`): the description, input schema and example of
  each signal, update and query.
- The types of the experimental AI views (loops, LLM steps), `@alpha`.
