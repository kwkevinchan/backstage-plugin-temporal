---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

A workflow whose entity reference search attribute is not an entity reference
is treated as a workflow without an entity. Opening it without `entityRef`,
when the list permission does not cover it, answers 403 (as for a workflow
without the attribute) instead of 400. `POST .../query` no longer answers 400
for it either: like the operations that change workflows, it needs the
permission allowed for every entity.
