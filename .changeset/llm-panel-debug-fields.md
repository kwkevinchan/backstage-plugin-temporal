---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

The LLM panel of a model call shows what the built-in adapters read and the panel did not show: the framework (`vercel-ai-sdk` or `openai-agents`) in the header, the cache write tokens in **Usage**, and a **Details** section with the response ID, the call parameters and the tool definitions. The panel no longer has the parts for `blob` and `uri` parts, tools that ran inside the model call's activity, the "Call 1 of 2" label and the note for a record read from a failed attempt; no built-in adapter produces them. `./common` loses the same names as the backend (see its changelog).
