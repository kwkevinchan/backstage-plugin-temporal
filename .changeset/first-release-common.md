---
'@kwkevinchan/backstage-plugin-temporal-common': minor
---

First release of the common package, shared by the frontend, the backend and
their modules: the permissions (`temporalPermissions`, including the
`temporal-workflow` resource type and its resource refs), the API types and
paths, the annotation constants, the `TemporalWorkflow` entity schema and
`getTemporalWorkflowSource()`, the rule for which workflows belong to an
entity, and `spec.messages` of that kind (`getTemporalWorkflowMessages()`,
`mergeWorkflowHandlers()`): the description, input schema and example of
each signal, update and query.
Permission policies import the permissions from here. Types and paths of
Temporal schedules (`TemporalSchedule`, `TemporalScheduleListResponse`).
