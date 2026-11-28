---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
---

Definition graph: `then: exit` and `then: continue` of a task inside `do`, `try`, `catch`, `for` and `switch` now leave only that body, and the task that holds the body goes on with its own `then`. A task with a `#` in its name can be selected from the graph. The Definition tab reloads a running run like the run page does: every 10 seconds, not in a background tab, and not while a load is running. `AUTO_REFRESH_MS` and `usePageVisible` are exported from `./ui`.
