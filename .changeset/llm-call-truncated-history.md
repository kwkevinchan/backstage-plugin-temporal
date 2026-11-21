---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

`GET .../llm-calls/:eventId` answers `404` with a message saying that the history was truncated when the step lies beyond the 5,000 events the backend reads, instead of saying that the run has no such model call.
