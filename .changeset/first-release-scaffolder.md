---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': minor
'@kwkevinchan/backstage-plugin-scaffolder-module-temporal': minor
---

First release of the Scaffolder modules. The backend module adds the template
actions `temporal:workflow:start`, `temporal:workflow:wait` (until the
workflow closes, or until a Bool search attribute is true) and
`temporal:workflow:signal` (signals and updates). They call the Temporal
backend plugin as the user who runs the template. The frontend module adds
the `TemporalWorkflowPicker` form field, which lists workflows by entity,
type, status and a Bool search attribute.
