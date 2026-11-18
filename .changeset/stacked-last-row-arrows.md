---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

In a stacked group frame (rounds of a loop one below the other), an arrow
that leaves the frame from the last row past other boxes of that row turns
down next to its step into a gap below the row, as from the other rows,
instead of running straight across those boxes; the frame is that gap
taller only when such an arrow exists. An arrow that leaves a frame in a
stacked frame no longer runs across a group frame next to it between that
frame's rows: it turns next to its step. Graphs without stacked frames are
laid out as before.
