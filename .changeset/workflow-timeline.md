---
'@kwkevinchan/backstage-plugin-temporal': minor
---

A **Timeline** tab on the workflow details page: one bar per step on a time
axis, with the time a step waited for a worker (scheduled to started) and
the time it ran (started to closed), the number of retries, failed steps in
red, dashed bars for timers and waits, and points for signals and updates.
The steps of a loop are grouped by round; the latest round is open and the
others can be expanded. Bars of a running workflow grow until now. Drag
across the chart or scroll with Ctrl held to zoom, Shift + scroll pans;
hovering a bar shows its times and pressing it opens the step panel of the
graph.
