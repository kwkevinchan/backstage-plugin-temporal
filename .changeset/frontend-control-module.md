---
'@kwkevinchan/backstage-plugin-temporal-module-control': minor
'@kwkevinchan/backstage-plugin-temporal': minor
---

The buttons that change workflows (Signal, Update, Cancel, Terminate,
Rerun, Start workflow and custom actions) move to the new frontend control
module, with their client `temporalControlApiRef`; without it the pages only
read. `TemporalApi` keeps the reads and `queryWorkflow`, and gets
`getWorkflowHandlers()` (`GET .../handlers`); the Query dialog stays in the
core plugin and needs `temporal.workflow.query`. Custom action buttons come
from `TemporalControlActionBlueprint` (new frontend system) or
`createTemporalControlActionDef()` (legacy) of the module;
`TemporalWorkflowActionDef` has no `controlAction` any more. The new
`TemporalWorkflowListActionBlueprint` and the `workflowListActions` prop add
controls above the workflow lists, and workflow actions get
`workflowHref()`. The `temporal.control.enabled` setting is removed.
