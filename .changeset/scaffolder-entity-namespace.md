---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
---

`temporal:workflow:wait` and `temporal:workflow:signal` follow the namespace of
`entityRef`, as `temporal:workflow:start` does, when no `namespace` is given:
the module reads the entity from the catalog as the user who runs the template.
An entity that cannot be read is an error instead of the default namespace.
`@backstage/plugin-catalog-node` is now a dependency of the module.
