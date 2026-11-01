---
'@kwkevinchan/backstage-plugin-catalog-backend-module-temporal': minor
'@kwkevinchan/backstage-plugin-temporal': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal-node': minor
'@kwkevinchan/backstage-plugin-temporal-react': minor
---

Add the `TemporalWorkflow` kind (`temporal.io/v1alpha1`) with a catalog
module that validates it and adds its relations. `TemporalWorkflow` entities
get a summary card, recent run statistics and their runs; entities that list
them in `spec.dependsOn` show them and merge their runs. Add the Workflows
page (`/temporal`, with a sidebar entry) and the `temporal.workflow.list`
permission. Support bearer token authentication of the Temporal connection
(`temporal.connection.auth.type: bearer`). Running workflows show a spinner
that turns. Target Backstage 1.56.
