---
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-catalog-backend-module-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
---

First release of the common package: the permissions, API types, annotation
constants, API paths and the `TemporalWorkflow` entity schema shared by the
frontend and backend. The frontend plugin still re-exports them,
so existing imports keep working; modules can import the common package
instead.
