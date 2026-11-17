---
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

The step graph is laid out with `@dagrejs/dagre` 3. Steps that run in
parallel can change places within their column: in the graphs drawn from
left to right, a branch that was drawn above another one can now be drawn
below it, while every step keeps its column; in the graphs drawn from top
to bottom (`layoutSteps` with `direction: 'TB'`), parallel branches can
swap sides.
