---
'@kwkevinchan/backstage-plugin-temporal-module-control': minor
---

First release of the frontend control module, with the backend control
module: Signal, Update, Cancel, Terminate and Rerun on the workflow details
page, Start workflow above the workflow lists, and buttons for custom
backend actions (`TemporalControlActionBlueprint` in `./alpha`,
`createTemporalControlActionDef()` for the legacy system). Its client is
`temporalControlApiRef`. Without this module the pages only read. Signals
and updates described in `spec.messages` with an `inputSchema` get a form
(`@rjsf/core`); the others a JSON field filled with their example.
Schedules get Pause or Resume and Run now (`temporal.workflow.start`,
recorded with the auditor).
