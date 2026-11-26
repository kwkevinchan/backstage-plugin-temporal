# How workflows map to the catalog

English | [繁體中文](zh-TW/catalog-model.md)

This guide explains why the catalog holds workflow types but not workflow
executions, how the plugin decides which entity a workflow belongs to, and who
can declare that. The settings themselves are in the
[README](../README.md#workflow-entities); this guide explains the design
behind them.

- [What is in the catalog](#what-is-in-the-catalog)
- [How a workflow is matched to an entity](#how-a-workflow-is-matched-to-an-entity)
- [Child workflows](#child-workflows)
- [Which entity the permissions are checked on](#which-entity-the-permissions-are-checked-on)
- [What a request costs](#what-a-request-costs)
- [Alternatives that were not chosen](#alternatives-that-were-not-chosen)
- [Who can declare that a workflow belongs to an entity](#who-can-declare-that-a-workflow-belongs-to-an-entity)

## What is in the catalog

The catalog holds things that last: a component, a system, a workflow type. It
does not hold what they do at run time.

Three Temporal terms matter here (see the [primer](temporal-primer.md)):

- A **Workflow Type** is the name of a piece of workflow code, for example
  `orderWorkflow`.
- A **Workflow Execution** is one time that code runs, found by its Workflow
  ID, for example `order-1001`.
- A **run** is one part of an execution, found by its Run ID. A workflow retry or a
  continue-as-new starts a new run with the same Workflow ID.

The catalog holds Workflow Types. Executions and runs stay in Temporal.

![The catalog holds a fixed number of entities: a component with Temporal annotations and TemporalWorkflow entities, one per Workflow Type. Temporal holds the workflow executions and their runs, and their number keeps growing. On each request the backend matches executions to entities; nothing is stored.](images/catalog-model.svg)

| In the catalog                                                            | Not in the catalog                  |
| ------------------------------------------------------------------------- | ----------------------------------- |
| `TemporalWorkflow` entities: one entity for one Workflow Type             | Workflow executions (a Workflow ID) |
| Annotations (`temporal.io/*`) on any entity                               | Runs (a Run ID)                     |
| `spec.dependsOn` links from other entities to `TemporalWorkflow` entities | The result of matching an execution |

The number of entities follows the number of workflow types, which changes when
someone writes new workflow code. The number of executions follows the traffic:
one order can start one execution. Temporal stays the only place where
executions are stored, and the plugin reads them when a page asks.

This is how other Backstage plugins treat run-time data. The Kubernetes plugin
finds pods through annotations on a component and does not put pods in the
catalog. The CI plugins (GitHub Actions, Jenkins) find builds the same way and
do not put builds in the catalog.

## How a workflow is matched to an entity

An execution belongs to an entity when **any one** of these matches:

1. **Annotations or spec of the entity.** The task queue and the workflow
   types of the entity's `temporal.io/*` annotations match, each when it is set.
   A task queue alone matches every workflow type on that queue. For a
   `TemporalWorkflow` entity, its `spec.taskQueue` and `spec.workflowType` are
   used the same way.
2. **The `entityRef` search attribute.** The execution carries the entity's
   reference in the search attribute set in `temporal.searchAttributes.entityRef`.
   It is set when the workflow starts, or by the workflow itself. Without that
   setting, this way is off.
3. **A `TemporalWorkflow` entity that the entity depends on.** The entity lists
   `temporalworkflow:default/order-workflow` in `spec.dependsOn`, and the
   execution matches that entity's spec, or carries that entity's reference in
   the `entityRef` search attribute. Only one level is followed, at most
   20 such entities are included, and only those in the same namespace that the
   user may read.

For a list, the three are joined with OR into one visibility query, so the
order does not matter. For one workflow (the details page and the operations),
the backend checks the same three rules on that workflow. The order only
matters for permissions, in the next sections.

The result is not stored. Change an annotation, and the first request after the
catalog has processed the change uses the new value.

## Child workflows

A child workflow does part of its parent's work. When a child does not match the
entity itself, the backend looks at its parent, then at the parent's parent, up
to **3 levels**. When an ancestor matches, the child is opened, and operated,
with that entity and its permissions.

The walk needs the parent's run ID. A parent with only a Workflow ID could be a
different execution with the same ID (a later run, or another namespace), so the
walk stops there and the child is not found on that entity.

## Which entity the permissions are checked on

The match decides which entity the read and operation permissions are checked
on. The [public interfaces guide](public-interfaces.md#which-entity-a-workflow-is-checked-on)
has the complete rules. In short, when a page opens a workflow through an
entity:

- When the entity's own annotations, spec or search attribute match (the
  workflow or one of its ancestors), only that entity is checked.
- When the match comes through a `TemporalWorkflow` entity that the opened
  entity depends on, **both** entities are checked: the opened entity and the
  matched `TemporalWorkflow` entity. So when another team's component shows
  the executions through `dependsOn`, the policies on the workflow type's
  entity still apply.

The second check happens only for a match through `dependsOn`. When another
entity matches the same executions by its own annotations or by the search
attribute, only that entity is checked, and the policies on the
`TemporalWorkflow` entity are not used. To make the owner's policies apply,
limit who can declare such matches; see
[the last section](#who-can-declare-that-a-workflow-belongs-to-an-entity).

## What a request costs

The work of each request does not grow with the number of executions:

| Request                   | What the backend does                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An entity's workflow list | Checks the read permission on the entity and reads it, checks the read permission on up to 20 `TemporalWorkflow` entities it depends on and reads the allowed ones, then sends **one** visibility query for one page                                                                                                                                                                                                                                                                              |
| One workflow              | Loads the entity and its related entities as above, describes the workflow (and reads its last event when it failed, timed out, was terminated or continued as new), and describes up to 3 ancestors when the workflow does not match by itself. Without `workflowEntityRef`, and when the opened entity is not the `TemporalWorkflow` entity of this workflow type, it also queries the catalog once with the user's credentials (by kind and `spec.workflowType`); the result only shows a link |
| The statistics of the tab | Loads the entity and its related entities as above, then one visibility query for the latest `limit` runs (50 by default, at most 100)                                                                                                                                                                                                                                                                                                                                                            |

Workflow enrichers registered by modules run on the returned items; their cost
depends on the module.

Temporal's visibility store answers the query. The catalog does no work when
executions start or end.

## Alternatives that were not chosen

**Write executions or runs into the catalog with an entity provider.** This
would make each execution an entity. It was not chosen:

| Topic                      | Matching on each request (chosen)                                                                            | Executions as catalog entities                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size and sync cost         | The catalog holds one entity for each workflow type                                                          | No upper limit. Every execution goes through catalog processing. When Temporal deletes a closed execution after its retention period, the entity stays behind and has to be removed |
| An owner on a workflow     | Set on the `TemporalWorkflow` entity; one execution can name another entity in the `entityRef` attribute     | The owner still has to come from the workflow type or the search attribute: a copy, not a new source                                                                                |
| Both sides confirm a match | Both sides can declare already: the catalog (annotations, spec, `dependsOn`) and Temporal (search attribute) | Does not help: someone still has to declare the match                                                                                                                               |
| Source of the data         | Temporal only. The status on the page is always current                                                      | Two sources. The catalog is one sync cycle behind, so a list and a details page can disagree                                                                                        |

**Create `TemporalWorkflow` entities automatically for each workflow type found
in Temporal.** The number of entities would stay small, but Temporal does not
know the owner or the system of a workflow type. In Backstage, the author of an
entity declares those in a YAML file. A provider like this can be added later as
a separate module, without a change to the model.

**Require both sides to declare a match.** The plugin could count an execution
only when the catalog and the search attribute agree. Today either one is
enough, and the [next section](#who-can-declare-that-a-workflow-belongs-to-an-entity)
says how to limit each one. A stricter mode can be added on top of the current
matching.

## Who can declare that a workflow belongs to an entity

Two groups can make an execution appear on an entity, and get its permissions
applied:

- **Catalog authors.** Annotations, the `TemporalWorkflow` spec and
  `spec.dependsOn` are in catalog YAML files. Anyone who can register or edit
  an entity can point it at any workflow type in an allowed namespace, and
  then read those executions, inputs and results included. Limit
  who can register and edit entities (catalog rules, review of the catalog
  files).
- **Anyone who can start a workflow or set its search attributes.** The
  `entityRef` search attribute is trusted as much as those callers. Limit write
  access to the Temporal namespaces, or do not set
  `temporal.searchAttributes.entityRef` when other writers should not decide
  ownership.

The plugin cannot check these claims against each other; it shows what the
catalog and Temporal declare. The [Security](../README.md#security) section of
the README lists all trust boundaries of the plugin.
