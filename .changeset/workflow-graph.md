---
'@kwkevinchan/backstage-plugin-temporal': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal-react': minor
---

Workflow details built around a step graph. The backend groups the history
into steps (activities with their attempts, timers, signals, updates, child
workflows, markers, start and end) with arrows between them, parallel
branches for overlapping steps and a waiting step for running workflows
(`GET .../graph`), and returns the progress of a run for lists
(`GET .../progress`). The details page shows a summary line, the graph
(React Flow with the dagre layout) with a panel for the selected step, and
tabs with the steps, the grouped or raw events and the details; running
workflows reload every five seconds. Workflow lists show the progress of
each run. The screens use `@backstage/ui` and follow the light and dark
themes. Workflow actions and sections of the blueprints attach to the shared
`api:temporal/workflow-extensions` mount point and show on the Workflows page
too. The history of workflows opened without an entity needs the new
`temporal.workflow.history.list` permission.
