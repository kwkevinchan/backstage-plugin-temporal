---
'@kwkevinchan/temporal-loop': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal-react': minor
'@kwkevinchan/backstage-plugin-temporal': minor
---

Loops of AI workflows (generate, check, revise).

The new `@kwkevinchan/temporal-loop` package runs in workflow code: each
activity of a round gets the activity ID `loop/<loop>/<round>/<step>`
(child workflows a memo entry and an ID suffix), the state of each loop is
upserted to the `temporal.loops` memo after each round and returned by the
`__loop_state` query, and continue-as-new carries the round count to the
next run. The README specifies the format for other SDKs.

The backend reads the markers: `GET .../graph` has `loops` (rounds with
their steps, decision and score) and nodes have `loop`; the new
`GET .../loops` adds up the rounds of the runs a workflow continued as new
and asks a running workflow for its state. The graph shows a loop as one box
that expands to one round, with controls to step through the rounds, and the
new Loops tab lists every round. `TemporalApi` has an optional
`getWorkflowLoops` method.

The graph is laid out for the new width at once when the step panel opens or
closes, instead of after the resize delay.
