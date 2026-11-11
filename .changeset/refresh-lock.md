---
'@kwkevinchan/backstage-plugin-temporal': patch
---

Fewer requests from open pages.

- The Refresh buttons (the workflow page, the workflow lists, the recent
  runs card) are locked after a press until the reload has ended and at
  least a second has passed, so pressing one again and again sends one
  request.
- The workflow page reloads a running workflow every ten seconds instead of
  five, not at all while its tab is in the background (it reloads when the
  tab is shown again), and asks for the step graph only when the run has
  new events or the state of its pending activities changed: the backend
  reads the whole history of a run for a graph.
