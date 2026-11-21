---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

Speed up graph edge building (`O(N log N + E)` two-pointer sweep instead of `O(N^2)` scans) and LLM tool-call linking (indexed lookups by tool call ID, model name, answer index, and normalized tool name plus per-candidate `canonicalJson` memoization) with identical output.
