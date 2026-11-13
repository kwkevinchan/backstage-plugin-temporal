---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

An activity is in a loop only when its ID starts with `loop/` (or `llm/<call>/`
or `tool/<call>/<id>/` followed by `loop/`), as the loop helpers write it. A
custom ID that merely ends like a marker, such as
`tenants/acme/loop/retry/2/charge`, is no longer taken for a loop step. Child
workflows are still recognized by a marker at the end of their workflow ID.
