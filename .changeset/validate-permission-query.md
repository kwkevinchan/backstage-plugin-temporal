---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
---

Check the visibility query string that a custom permission rule's `toQuery` returns, before it joins the workflow list query. The plugin now rejects an empty string, an unclosed quote, unbalanced parentheses and a comment outside quotes (`/* */`, `--`, `#`, `//`); a rejected rule answers the list with 403 and lists nothing. A rule that returned an empty string before now gets a refusal. `./alpha` also exports `inCondition` and `quote`, to build such a string from checked values; `inCondition` throws `InputError` for an empty list of values.
