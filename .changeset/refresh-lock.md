---
'@kwkevinchan/backstage-plugin-temporal': patch
---

Fewer requests from the Refresh buttons and the workflow page.

- The Refresh buttons (the workflow page, the workflow lists, the recent
  runs card) are locked after a press until the reload has ended and at
  least a second has passed, so pressing one again and again sends one
  request.
- The workflow page reloads a running workflow every ten seconds, not at
  all while its tab is in the background (it reloads when the tab is shown
  again). An automatic reload does not start while another reload is
  running. It fetches the step graph when the run changed (new events,
  another status or run, or a change in its pending activities) and at
  least once a minute; a heartbeat alone does not count as a change. The
  backend reads the whole history of a run for a graph.
