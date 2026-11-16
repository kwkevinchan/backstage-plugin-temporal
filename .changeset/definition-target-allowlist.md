---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': minor
---

Restrict relative `spec.definition.target` paths to the entity's repository and require `temporal.definitions.allow` entries for absolute `http(s)` definition URLs. Entities whose `spec.definition.target` uses an absolute URL (including URLs pointing to their own repository) will show an error after upgrading unless changed to a relative path or allowed under `temporal.definitions.allow`.
