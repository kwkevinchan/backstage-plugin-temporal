---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': minor
'@kwkevinchan/backstage-plugin-scaffolder-module-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend-module-actions': patch
---

Breaking: `temporal:workflow:signal` no longer takes `kind` and only sends signals. Updates now use the new `temporal:workflow:update` action, which has the same inputs (`workflowId`, `runId`, `namespace`, `entityRef`, `name`, `args`) and outputs `result` and `runId`. Change `action: temporal:workflow:signal` with `kind: update` to `action: temporal:workflow:update` and remove `kind`. A permission policy, a template allow list or any rule written for the action ID `temporal:workflow:signal` must also name `temporal:workflow:update`. The new action refuses a task that does not run as a user unless `temporal.scaffolder.allowServiceWrites` is true, like `start` and `signal`.

Also breaking: `temporal:workflow:wait` no longer takes `maxIntervalSeconds`; the pause doubles up to 30 seconds, and an `intervalSeconds` above 30 is a fixed interval. Remove the input from templates.

`temporal:workflow:wait` now ends only on a closed status and keeps waiting while the status is `Unknown`; its dry run outputs the status `Unknown` instead of `Completed`. An update whose result is `null` now outputs `result: null` (it was left out). The workflow picker lists a workflow ID once when it has several runs.

The actions module counts a `Terminated` step as failed, and answers a 5xx response of the Temporal plugin with a fixed message instead of the message of the response.
