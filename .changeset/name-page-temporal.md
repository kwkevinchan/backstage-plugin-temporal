---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Name the standalone page "Temporal", like the entity tab. The new frontend system shows "Temporal" as the page title and in the sidebar, and the legacy `TemporalPageWithHeader` has the header title "Temporal" with the subtitle "Workflow executions". Add `text="Temporal"` to the `SidebarItem` of an app in the legacy frontend system to match. The URL `/temporal` and the route refs do not change.
