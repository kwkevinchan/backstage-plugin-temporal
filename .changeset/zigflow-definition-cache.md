---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': minor
---

Cache definition files read from URLs in memory for a short time (`temporal.definitions.cacheTtlSeconds`, default 30 seconds, per backend process), share one read between simultaneous requests for the same URL, and cap concurrent reads (`maxConcurrentReads`, default 4) and reads per minute (`maxReadsPerMinute`, default 120), so Definition tab views do not use up the API quota of the source host. Failed reads are not cached. `@backstage/plugin-permission-common` is now a development dependency.
