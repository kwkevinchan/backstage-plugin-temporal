---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

The group of a signal or update received during an open round of a loop,
whose arrows come from that round and lead back into it (or nowhere), now
goes in the frame of that round instead of a row below it. It runs beside
the steps of the round as a branch in its own lane above or below them:
the steps of the round stay on their line, steps that ran at the same time
as the group are in the same column, and the steps after it move right
when the group needs more room. A frame and a frame inside it no longer
count as groups side by side, and a box that an arrow only touches by a
pixel stays where it is.
