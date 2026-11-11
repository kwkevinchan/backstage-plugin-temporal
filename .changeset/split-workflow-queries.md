---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Internal restructuring: the backend's workflow query service is split into
four smaller classes. No behaviour change: routes, responses and the
package's public API are unchanged.
