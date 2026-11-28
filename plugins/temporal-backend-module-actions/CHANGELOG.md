# @kwkevinchan/backstage-plugin-temporal-backend-module-actions

## 0.1.0

### Minor Changes

- First release of the backend module that registers Temporal actions in the
  Backstage actions registry: `list-workflows`, `get-workflow`,
  `start-workflow`, `signal-workflow` and `update-workflow`. AI assistants
  and MCP clients call them as the caller, with the permission checks and
  audit records of the workflow pages. The actions that change workflows are
  not `readOnly`, so a caller can ask a person first, and they refuse a
  service principal unless `temporal.actions.allowServiceWrites` is true.
