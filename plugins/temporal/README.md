# @kwkevinchan/backstage-plugin-temporal

Unofficial Backstage frontend plugin for [Temporal](https://temporal.io). Adds
a **Temporal** tab to catalog entities with Temporal annotations: the workflow
list (status filter, paging) and workflow details (summary, failure with its
cause chain, pending activities, event history, link to the Temporal UI).

- Legacy frontend system: `temporalPlugin`, `EntityTemporalContent`,
  `isTemporalAvailable`.
- New frontend system: the default export of `./alpha`.

Extensions for the workflow page come from
`@kwkevinchan/backstage-plugin-temporal-react`. See the
[repository README](../../README.md) for installation and configuration.
