---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

Warn at startup when a `temporal.definitions.allow` rule omits `paths` on a host backed by a Backstage integration, and reject `temporal.externalStorage.objectUrl` templates whose hostname depends on `{bucket}` or `{key}` without at least two fixed domain labels.
