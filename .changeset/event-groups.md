---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

The graph response (`GET .../graph`) has the Temporal event groups of the
run (experimental in Temporal; server 1.32 and TypeScript SDK 1.23 or
later): `eventGroups` lists each group with its key (`label:<id>`,
`event:<event ID>`, `update:<update ID>`), name, steps, inferred parent and
child groups, status, times and the tokens of its model calls, and
`groups` on each step lists the keys of its groups, outer groups first. A
label that a payload codec encoded is replaced by the group ID
(`labelUnreadable`). The groups need the read permission only and do not
depend on `temporal.experimental.aiWorkflows`; runs without groups answer
as before. The new types `WorkflowEventGroup` and `WorkflowEventGroupKind`
in `./common` are `@alpha`.

The built-in LLM adapters' values are no longer copied for every graph;
values of adapters that modules add still are.
