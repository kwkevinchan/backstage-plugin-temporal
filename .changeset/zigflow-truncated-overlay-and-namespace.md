---
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
---

Mark unmatched tasks as `Unknown` with a truncated-history banner instead of `Not reached` when a run graph is truncated, fall back to the entity's `spec.namespace`, and wait until namespace resolution is ready before fetching a run graph when `runId` is in the URL.
