---
'@kwkevinchan/backstage-plugin-temporal': patch
---

The workflow graph is laid out again for the narrower area when the step
panel opens, and for the wider one when it closes, so every step stays in
view at a readable size and the first column is not cut off. The new layout
waits until the width of the graph area has settled, so resizing does not
make the graph jump. Long graphs get a little more height before they need
panning.
