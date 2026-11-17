---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

When laying out the step graph throws (a long chain can exhaust the call
stack in dagre), the graph area shows the error and the rest of the run
page stays usable. When the call stack ran out, the message says that the
run has too many steps in a row.
