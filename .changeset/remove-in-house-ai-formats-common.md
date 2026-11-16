---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
---

`./common` no longer exports the names of the in-house loop and LLM formats,
and the `temporal.experimental.aiWorkflows` setting is gone from the config
schema.

Removed from `./common` (a generated copy in both packages):

- constants: `LLM_MARKER_PREFIX`, `LLM_RECORD_KEY`, `LLM_RECORD_VERSION`,
  `LLM_SEMCONV_VERSION`, `LLM_TOOL_RESULT_KEY`, `TOOL_MARKER_PREFIX`,
  `LOOP_MARKER_MEMO_KEY`, `LOOP_STATE_MEMO_KEY`, `LOOP_STATE_QUERY`
- function: `parseLlmMarker`
- types: `WorkflowLlmMarker`, `WorkflowLoopGroup`, `WorkflowLoopMarker`,
  `WorkflowLoopRound`, `WorkflowLoopRun`, `WorkflowLoopStatus`,
  `WorkflowLoopStep`, `WorkflowLoopsResponse`

`./common` now has 110 names, 14 of them `@alpha`.

A config file that still sets `temporal.experimental.aiWorkflows` keeps
working: the key is ignored. `backstage-cli config:check` passes with and
without `--lax`. Only `backstage-cli config:check --strict`, which rejects
every key that no schema declares, fails on it (`Config must NOT have
additional properties` at `/temporal`). Remove the key from your config.
