---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

The status of an event group after its run ended is Failed when a step of
the group failed, even when another step was left open (a timer that had not
fired), instead of Canceled. A group with a step left open is changed only
when the run has a known final status; while the status of the run is
unknown it comes from the steps.
