---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

A provider-executed tool result on a Vercel AI SDK model call is shown as
the raw `result` value. An object shaped like `{ type, value }`, and a
`null`, `0` or empty-string result, stay as they are. A prompt-shaped
`output` is still unwrapped when `result` is absent.
