---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': minor
'@kwkevinchan/backstage-plugin-scaffolder-module-temporal': minor
---

First release of the Scaffolder modules. The backend module adds the template
actions `temporal:workflow:start`, `temporal:workflow:wait` (until the
workflow closes, or until a Bool search attribute is true, polling less
often the longer it waits, up to `maxIntervalSeconds`) and
`temporal:workflow:signal` (signals and updates). They call the Temporal
backend plugin as the user who runs the template; when its operations are
turned off (`temporal.control.enabled: false`), `start` and `signal` fail
with a message that says so. `wait` and `signal` run in the namespace of
their `entityRef` when no `namespace` is given (as `start` does), reading the
entity from the catalog as that user; an entity that cannot be read is an
error. The frontend module (it needs
`@kwkevinchan/backstage-plugin-temporal-frontend`) adds the
`TemporalWorkflowPicker` form field, which lists workflows by entity, type,
status and a Bool search attribute.
