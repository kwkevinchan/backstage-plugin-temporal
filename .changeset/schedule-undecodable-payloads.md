---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

A schedule whose memo or action arguments cannot be decoded (binary data, or
encoded by a payload codec such as encryption) no longer breaks the schedule
lists, which answered 500 for the whole namespace, nor Pause, Resume and Run
now on that schedule, which answered 500 with `Unknown encoding`. The
schedule is listed and operated like any other; the plugin does not show a
schedule's memo or arguments.
