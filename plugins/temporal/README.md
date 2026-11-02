# @kwkevinchan/backstage-plugin-temporal

Unofficial Backstage frontend plugin for [Temporal](https://temporal.io).

## Purpose

Shows Temporal workflows next to the catalog entities that own them: a
**Temporal** tab with the workflow list and its progress, a details page with
the step graph, a **Timeline** tab (steps on a time axis), the loops of AI
workflows, events and details, the workflow controls, cards for
`TemporalWorkflow` entities and a **Workflows** page. Works with the legacy
and the new frontend system of Backstage 1.56.

## Installation

```sh
yarn --cwd packages/app add @kwkevinchan/backstage-plugin-temporal
```

It needs the backend plugin
[`@kwkevinchan/backstage-plugin-temporal-backend`](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal-backend/README.md).
See the [repository README](https://github.com/kwkevinchan/backstage-plugin-temporal#readme) for the setup of both frontend systems and
the configuration.

## API

New frontend system (`@kwkevinchan/backstage-plugin-temporal/alpha`): the
default export is the plugin, with the entity content, the Workflows page,
the entity cards and the APIs.

Legacy frontend system:

| Export                                                                                | What it is                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `temporalPlugin`                                                                      | The plugin.                                        |
| `EntityTemporalContent`                                                               | Entity tab: workflow list and details.             |
| `TemporalPage`                                                                        | Workflows page with every workflow of a namespace. |
| `EntityTemporalWorkflowSummaryCard`                                                   | Summary card of a `TemporalWorkflow` entity.       |
| `EntityTemporalWorkflowStatsCard`                                                     | Recent run statistics of an entity.                |
| `EntityTemporalRelatedWorkflowsCard`                                                  | Workflow entities a component depends on.          |
| `isTemporalAvailable`, `isTemporalWorkflowEntity`, `getDependsOnTemporalWorkflowRefs` | Conditions for entity pages.                       |
| `TemporalClient`                                                                      | Client of the backend API (`TemporalApi`).         |

Extensions of the workflow page (actions and sections) come from
[`@kwkevinchan/backstage-plugin-temporal-react`](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/plugins/temporal-react/README.md).
