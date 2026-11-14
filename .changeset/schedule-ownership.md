---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

One rule decides which schedules belong to an entity, for its schedule list
and for pausing, unpausing and triggering: the schedule starts a workflow type
of the entity (or of a related `TemporalWorkflow` entity) and, when that
entity has a task queue, runs on it. An entity with only a task queue and no
workflow type has no schedules, so operating on a schedule of its queue is
refused with 404 like any schedule that is not its own.
