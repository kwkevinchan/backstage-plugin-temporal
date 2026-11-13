---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

A workflow whose entity reference search attribute is not an entity reference
is treated as a workflow without an entity by every route that checks a
permission on it. `POST .../query` no longer answers 400 for it: like the
operations that change workflows, it needs the permission allowed for every
entity.
