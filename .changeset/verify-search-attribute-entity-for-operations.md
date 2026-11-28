---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Check an operation (query, signal, update, cancel, terminate, rerun, custom actions) on a workflow opened without `?entityRef=` on the entity of its entity reference search attribute only when the workflow opens with that entity as with `?entityRef=`: the caller may read the entity, and the workflow is in its namespace and is one of its workflows. The permission is then also checked on the matched `TemporalWorkflow` entity. An entity that does not pass counts as none, so only a permission allowed without conditions lets the operation through, and custom actions and audit records no longer get it.
