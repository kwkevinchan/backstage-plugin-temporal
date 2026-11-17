---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

In a stacked event-group frame, arrows that leave or enter through a gap
between rows take a lane in that gap, and an arrow whose way down beside
its target or its source is blocked, or that would run across a row of
groups side by side, turns down the side of the frame on the next free
lane instead of running through the rows. The side widens for arrows past
three, and the lanes there go around an arrow that runs on past the frame.
An arrow inside a row no longer runs through a taller box next to it: that
box moves just enough to clear the line. Graphs without stacked frames are
unchanged.
