---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

In the graph of a run with event groups, arrows into and out of a group's
box turn outside it, clear of its border, and cross the border straight;
steps and boxes next to a box are as far from its border as two steps are
from each other, and arrows that share the gap between two rows run side
by side. Each group gets a faint color to tell it apart from the groups next
to it: the outermost groups take four colors in turn and the groups inside
them have their color; signal and update groups have the color of messages.
The collapsed boxes, the labels, the timeline and the Event Groups tab show
the same colors. Runs without event groups are drawn as before.
