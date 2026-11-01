---
'@kwkevinchan/backstage-plugin-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-common': patch
'@kwkevinchan/backstage-plugin-temporal-react': patch
---

Easier to read workflow graphs. The graph opens at a readable size (step
text at least 12px) starting at its first step; long runs wrap into rows and
the rest can be panned to, and "Whole graph" zooms out to every step.
Opening the step panel no longer shrinks the graph: the selected step is
panned into view. The graph area is as tall as the graph, within limits.
Markers (side effects, version and patch markers) are left out of the graph
and the step list by default and can be shown with a switch; local
activities stay. A wait with a time limit, like `condition(fn, '24h')`,
shows its waiting hint (`*Pending` search attribute) with the timer as the
time limit, and timers show when they fire in the user's time zone
(`deadline` and `currentDeadline` in the graph and progress responses).
Workflow lists show only the latest run of a workflow that continues as new,
with a "Show all runs" switch (`allRuns` in the list endpoints and the
client), and the details page links the previous and next run with the run's
position (`runChain` in the graph response). The Workflows page has the page
margins of the new frontend system.
