---
'@kwkevinchan/backstage-plugin-temporal-node': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-catalog-backend-module-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
---

First release of the node package: `temporalServiceRef` (the shared Temporal
client) and `temporalExtensionPoint` for backend modules. The backend plugin
now exports only the plugin; import the service and the extension point from
`@kwkevinchan/backstage-plugin-temporal-node`, and the permissions and types
from `@kwkevinchan/backstage-plugin-temporal-common`.
`TemporalWorkflowEnricherContext.entity` is optional.
