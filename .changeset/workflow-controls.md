---
'@kwkevinchan/backstage-plugin-temporal': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal-node': minor
'@kwkevinchan/backstage-plugin-temporal-react': minor
---

Workflow controls: start a workflow (from a `TemporalWorkflow` entity, with
its `spec.exampleInput`, or from the Workflows page), signal, update and query
it, cancel or terminate it, and rerun a closed run. Every operation is checked
with new permissions (`temporal.workflow.start`, `.signal`, `.update`,
`.cancel`, `.terminate`, `.rerun`; allowed unless a policy denies them) and
recorded with the auditor. `temporal.control` turns the operations off or
limits the signal and update names. Backend modules add custom actions with
`temporalExtensionPoint.addControlAction()`; the frontend shows them as
buttons through `TemporalWorkflowActionBlueprint` (`controlAction`) or
`createTemporalControlActionDef()`.
