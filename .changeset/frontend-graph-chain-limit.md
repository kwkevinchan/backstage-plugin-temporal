---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

Fail fast in `layoutSteps` with `CHAIN_LAYOUT_LIMIT` (1200) before long step chains exhaust dagre's recursive DFS call stack, avoid repeating a failed flat layout inside `layoutGroupedSteps`, direct users to the Steps tab when the layout limit is hit, and record 1,000-step layout benchmark measurements in the architecture guide.
