---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
---

Backend log messages are now fixed strings with the changing values in fields (`namespace`, `workflowId`, `entityRef`, `temporalCall`, `grpcStatus` and others), so logs can be filtered by field. Every call to Temporal is logged at `debug` with its duration, and a failed call with its gRPC status, at `warn` when the server or the backend's credentials are at fault. Permission conditions the plugin cannot apply, invalid `TemporalWorkflow` specs, a connection that cannot be opened and an update that does not finish within the polls are logged at `warn`. The wording of the existing messages changed, and the `service: temporal` field of the connection log is gone.
