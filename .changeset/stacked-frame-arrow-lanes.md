---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

In a stacked event-group frame, arrows that leave or enter through a gap
between rows take a lane in that gap, and an arrow whose way down beside
its target or its source is blocked turns down the side of the frame on
the next free lane instead of running through a lower row. A straight
arrow inside a row no longer runs through a taller box that shares its
middle: that box moves just enough to clear the line. When more than one
signal arrow turns down or back in the seam between two steps, that seam
widens by a lane per arrow, and the signal row may extend the frame. A
round whose one signal already has room keeps its width, and graphs
without stacked frames are unchanged.
