---
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

A graph without steps is laid out at a size of zero instead of an infinite
negative one. Two expanded loops of the same shape, one after the other, keep
the arrow between the rounds of each loop in the middle of its own gap, instead
of spreading the two arrows apart as if they shared one gap.
