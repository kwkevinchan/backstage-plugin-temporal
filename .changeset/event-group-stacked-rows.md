---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

In the graph of a run with event groups, a group with two or more groups
directly inside, at least one of them expanded (the rounds of a loop with a
round open), shows those groups one below the other instead of in one long
row: each expanded group in a row of its own, with its steps left to right,
and collapsed groups next to each other in a row, in the order they
started. An arrow into the next row leaves the right end of a row, runs
back left in the gap between the rows and enters the next row from the
left; arrows that run past rows at the sides of the group run side by side
in lanes, and the gap between two rows is taller when more than three
arrows run in it. The group of a signal or update received during a round, whose
arrows lead only from and back into the stacked groups, is drawn in the
innermost stacked group they lead from and back into (the loop, or the
round itself when its own groups are stacked), in a row below the row its
first arrow comes from; the groups of signals received during one row
share a row, side by side. Groups inside the rows stack in the same way.
Graphs whose groups are all collapsed, or that hold one group each, are
laid out as before. `StepLayout` has a new `stackGaps` field with the gaps between
these rows.
