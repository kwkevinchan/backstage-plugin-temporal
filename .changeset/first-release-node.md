---
'@kwkevinchan/backstage-plugin-temporal-node': minor
---

First release of the node package, for backend modules:
`temporalServiceRef` (the shared Temporal client, with bearer token
authentication) and `temporalExtensionPoint` (workflow enrichers). The
`./alpha` entry point has `temporalAccessServiceRef` (the access checks of the
plugin, plugin-scoped and replaceable), `temporalWorkflowPermissionResourceRef`
`temporalControlExtensionPoint` (custom control actions) and the JSON
payload helpers `encodeJsonPayloads` and `decodeJsonPayloads`. A new major of
`@temporalio/client` is a new major of this package.
