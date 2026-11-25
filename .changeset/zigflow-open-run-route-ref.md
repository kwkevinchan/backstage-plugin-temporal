---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
---

Export `entityContentRouteRef` from `@kwkevinchan/backstage-plugin-temporal-frontend/ui` (`@alpha`) and resolve the Zigflow Definition tab's "Open the run" link through it, hiding the button when the Temporal entity tab is not mounted.
