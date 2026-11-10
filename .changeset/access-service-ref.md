---
'@kwkevinchan/backstage-plugin-temporal-node': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Add `temporalAccessServiceRef` (alpha, plugin scope) to the node package: the
access checks of the plugin, shared with its modules. The backend's default
export now installs the plugin together with the default factory of this
service; a backend can add its own factory to decide access in another way.
