---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

The group of a signal or update received during an open round of a loop,
whose arrows come from that round and lead back into it (or nowhere), now
goes in the frame of that round instead of a row below it. It runs below
the steps of the round as a branch in a lane of its own, the groups of a
round one below the other: the steps of the round stay on their line,
steps that ran at the same time as a group are in the same column, and the
steps after it move right when the group needs more room. When the groups
of a round do not fit in lanes that keep their arrows apart, they stay in
the row below the round. A frame and a frame inside it no longer
count as groups side by side, and a box that an arrow only touches by a
pixel stays where it is.
