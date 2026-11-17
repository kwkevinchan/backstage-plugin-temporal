---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

The step graph is laid out with `@dagrejs/dagre` 3. Steps that run in
parallel can change places within their column: in the graphs drawn from
left to right, a branch that was drawn above another one can now be drawn
below it, while every step keeps its column; in the graphs drawn from top
to bottom (`layoutSteps` with `direction: 'TB'`), parallel branches can
swap sides. The height of a graph drawn from left to right, and the width
of one drawn from top to bottom, can change a little. Arrows into the next
row that turn down less than an arrow lane apart are spread out side by
side like the ones that turn at the same place, where they all fit and
none of them then runs on another arrow.
