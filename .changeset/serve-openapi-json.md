---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Serve the OpenAPI spec at `GET /api/temporal/openapi.json`, so the catalog module `@backstage/plugin-catalog-backend-module-backstage-openapi` and other tools can read it from a running backend. The paths carry the `/api/temporal` prefix, and the operations that change workflows are left out when `temporal.control.enabled` is false. The route needs Backstage credentials like the others. `yaml` is now a runtime dependency of the package.
