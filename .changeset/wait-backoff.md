---
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': minor
---

The `temporal:workflow:wait` step now doubles its polling interval after each look, up to the new `maxIntervalSeconds` input (30 seconds by default), so a long wait sends far fewer requests. Set `maxIntervalSeconds` equal to `intervalSeconds` for a fixed interval.
