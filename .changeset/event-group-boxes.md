---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

The workflow page draws Temporal event groups: each group is a box around
its steps in the graph, nested in the box of its parent group and
collapsible, with its status, duration, tokens and `×N` for the groups
directly inside. The timeline groups the steps by event group, and an
**Event Groups** tab lists the groups; pressing one opens it in the graph.
Runs without event groups are laid out as before. Experimental, like Event
Groups in Temporal.

In every run, a model call box without a call name no longer repeats its
model below the title, and a tool call linked to its model call by name and
order shows a link icon (with a tooltip) instead of the words "Inferred
link".
