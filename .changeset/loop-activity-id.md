---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

An activity is in a loop only when the whole ID is a loop marker
(`loop/<loop>/<round>/<step>`), or the whole rest after `llm/<call>/` or
`tool/<call>/<toolCallId>/` is one. A custom ID that merely ends like a
marker, such as `tenants/acme/loop/retry/2/charge`, is no longer taken for a
loop step. Child workflows are still recognized by a marker at the end of
their workflow ID. The IDs the workflow kit writes are unchanged.
