---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
---

Read and parse workflow definitions within fixed time and memory limits. Duplicate keys are found in one pass, so a file with many keys no longer blocks the backend; a definition may use at most 20 aliases, nest at most 64 levels and expand to at most four times its size, and an alias inside its own anchor is reported as a parse error instead of failing the request. A `serverless-workflow` target must be a `.yaml` or `.yml` file, and the text of a file with an error is no longer returned, so the tab shows only the error. Absolute URLs with a user name or password are rejected. With `temporal.definitions.readFileLocations`, only regular files are read, symlinks must stay in the folder of the entity file, and reading stops at `maxBytes` also for files that report a wrong size. The S3 path-style host check no longer backtracks on long hostnames.
