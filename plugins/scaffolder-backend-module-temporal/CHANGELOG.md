# @kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal

## 0.1.0

### Minor Changes

- First release of the Scaffolder backend module, with the template actions
  `temporal:workflow:start`, `temporal:workflow:wait` (until the workflow
  closes, or until a Bool search attribute is true), `temporal:workflow:signal`
  and `temporal:workflow:update`. They call the Temporal backend plugin as
  the user who runs the template, so its permission checks and audit records
  apply. `start`, `signal` and `update` refuse a task that does not run as a
  user unless `temporal.scaffolder.allowServiceWrites` is true, and fail with
  a message that says so when `temporal.control.enabled` is false in the
  Temporal backend.
