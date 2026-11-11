# The plugin and the Temporal Web UI

English | [繁體中文](zh-TW/compared-to-temporal-ui.md)

This guide answers: do you still need the Temporal Web UI, and which one should
you use for what? They do not replace each other. The Temporal Web UI is a tool
for operators who look at a whole cluster. The plugin lets a development team see
and operate the workflows of its own components next to the component in
Backstage. For anything the plugin does not do, the details page has an **Open in
Temporal UI** link (set `temporal.webUi.baseUrl`).

The two figures below are schematic drawings, not screenshots of either product.
Their layouts show what each tool puts first; the labels name features, not exact
screens, which differ between Temporal UI versions.

## The workflow list

![Two wireframes side by side. Left, the Temporal Web UI Workflows page: a namespace selector, a filter bar over all workflows, a table of status, ID, type and times, batch operations and further pages. Right, the plugin's Temporal tab of an entity: only the entity's workflows with a progress column, plus schedule operations; Start workflow is on TemporalWorkflow entities and the Workflows page.](images/compare-list.svg)

Left: the Temporal Web UI lists every workflow of a namespace, with a query bar
and, around it, the cluster's other areas. Right: the plugin lists the workflows
that belong to the entity you are looking at, adds a progress column (the current
step, or the step where it failed), and offers the operations your policy allows.
The **Workflows** page lists a whole namespace when you may list every workflow.

## One workflow

![Two wireframes of a single workflow. Left, the Temporal Web UI: header with actions, summary with input and result, the event history, and further tabs for workers, pending activities and queries. Right, the plugin: header with the run position and actions, a step graph with a step panel, and tabs for the timeline, events and details.](images/compare-detail.svg)

Left: the Temporal Web UI shows the event history, event by event. Right: the
plugin draws the steps as a graph and opens a panel with input, output, error and
attempts when you select one; the timeline and the raw events are tabs. The event
history is the same; the plugin groups it into steps.

## Side by side

What the Temporal Web UI offers depends on its version; see the
[Temporal documentation](https://docs.temporal.io/web-ui).

|                             | Temporal Web UI                                                                              | This plugin                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| How you get there           | Pick a namespace and search all workflows                                                    | From a Backstage component or `TemporalWorkflow` entity, showing only what belongs to it; a Workflows page shows the rest     |
| Who may see and do what     | Temporal's namespace permissions                                                             | Backstage permissions, down to "only the component's owners may terminate"; operations are audited and attributed to the user |
| Main view                   | Event history and timeline                                                                   | A step graph; select a box for input and output. Timeline and events are tabs                                                 |
| Operations                  | Start, signal, update, query, cancel, terminate, reset, batch operations, schedules and more | Start, signal, update, query, cancel, terminate, rerun, and pause, resume or trigger schedules                                |
| Cluster areas               | Namespaces, task queues, workers, worker versioning, Codec Server, creating schedules        | None; use **Open in Temporal UI**                                                                                             |
| Large data                  | Shows the External Storage reference                                                         | Reads the object from S3 and shows it, a preview or a thumbnail, with a download                                              |
| AI workflows (experimental) | A long list of activities                                                                    | Loops folded into rounds and a panel for each model call                                                                      |
| Catalog context             | None                                                                                         | Owner, system, dependencies and the catalog graph next to the workflows                                                       |

## When to use which

- **Use the plugin** to answer "what is happening with my service's workflows?",
  to let people start or nudge a workflow without giving them Temporal access, and
  when permissions and an audit trail have to follow Backstage's rules.
- **Use the Temporal Web UI** (or the CLI) to reset a workflow, run a batch
  operation, create or edit a schedule, look at workers and task queues, and
  whenever you need every workflow of the cluster regardless of owner.
- **Use both** while debugging: open a run in the plugin, and follow
  **Open in Temporal UI** to the same run for what the plugin does not show.

Back to [the documentation index](README.md).
