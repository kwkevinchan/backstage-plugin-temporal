---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

The workflow graph no longer fails for a deeply nested tool payload: a payload nested more than 64 levels is not compared when tool calls are linked by inference (it used to overflow the call stack). The backend also infers tool links for at most 500 unlinked tool requests in one model call and 2000 in one run; above either limit it infers none for the whole run, and the tool steps stay plain steps. The documentation now shows how to limit the load of the graph and `llm-calls` routes with a rate limit for the Temporal plugin only (`backend.rateLimit.plugin.temporal`).
