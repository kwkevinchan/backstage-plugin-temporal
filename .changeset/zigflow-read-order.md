---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
---

Read a `file:` definition only after its real path is checked: a file outside the folder of the entity file is never opened, and a missing file, a file without access and a file outside the folder get the same answer. The message for too many aliases now says that a file may have at most 20 aliases in all and at most 19 for one anchor.
