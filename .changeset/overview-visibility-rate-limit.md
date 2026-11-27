---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

The Workflows overview (`POST /workflow-types/overview`) paces its visibility calls: at most `temporal.overview.maxVisibilityCallsPerSecond` (new setting, default `5`) calls start per second in a namespace on each backend process, next to the limit of 4 in flight. The calls wait in a queue ordered by deadline, so the rows of the request that came first are read first. A row whose calls do not start within the 15-second list deadline now shows the error `Temporal did not answer in time` instead of running late, with no call made to Temporal for it, and the backend writes one warning for each overview request that has such rows. At the default rate an uncached page of 25 rows needs 10 to 15 seconds to load; raise the setting, or the visibility limits of Temporal, when a page has rows without numbers.
