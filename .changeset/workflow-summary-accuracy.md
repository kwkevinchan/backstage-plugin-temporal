---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

The one-line summary of a run (`current` of the graph and of the list progress) is more accurate:

- When the history is too long to read to its end, a running workflow's summary shows its pending activities, and a closed workflow's summary reads the failure from its close event, instead of guessing from the start of the history.
- "Failed at X" now follows the cause chain of the close event's failure. An activity failure that the workflow caught no longer shows as the failed step; when the chain has no activity or child workflow, the summary is the failure message.
- A waiting hint from a `…Pending` search attribute applies only when exactly one timer is open, so an unrelated `sleep` no longer shows as the wait.
