---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
---

Target the workflow execution chain (`firstExecutionRunId` without `runId`) for terminate, cancel, and update operations so they reach the currently running execution across Continue-As-New, retry, cron, or reset while rejecting later chains that reuse the same workflow ID.

- `temporal-backend`: expose `firstRunId` on `WorkflowDetail` and `TemporalControlActionContext`; remove the single-run `Running` check on terminate, cancel, and update and map Temporal chain-ended or mismatched-chain errors to `409`; record `firstRunId` and `scope: 'chain'` in audit metadata; keep signal locked to the opened run with `continuedAsNewRunId`.
- `temporal-frontend`: enable update, cancel, and terminate from a `ContinuedAsNew` run, clarify chain scope in dialog descriptions (with specific wording when viewing a continued-as-new run), and show the `continuedAsNewRunId` conflict link only for signals.
- `scaffolder-backend-module-temporal`: limit the `continuedAsNewRunId` 409 retry in `temporal:workflow:signal` to `kind: 'signal'`.
