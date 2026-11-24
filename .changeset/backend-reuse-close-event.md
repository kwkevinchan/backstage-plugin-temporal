---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Reuse the close event already fetched by `WorkflowQueries.describe` when building the graph for truncated failed, timed-out, or terminated runs instead of reading it a second time, and record `AiWorkflowQueries.llmCall` benchmark measurements in the architecture guide.
