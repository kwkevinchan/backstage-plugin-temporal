---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

In the graph of a run with event groups, the steps of a group that are one
row line up at their middles, also when a step outside the group (a signal
received during a round of a loop) is in the column of one of them.
Arrows into the next row that turn down at the same place, out of different
steps or into different steps, turn side by side instead of on top of each
other, nested so that they do not cross, and stay inside the graph.
Arrows that share the gap between two rows run 10px apart instead of 6px,
and the gap between rows with groups is 8px taller for them.
