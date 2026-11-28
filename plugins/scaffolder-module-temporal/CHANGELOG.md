# @kwkevinchan/backstage-plugin-scaffolder-module-temporal

## 0.1.0

### Minor Changes

- First release of the Scaffolder frontend module, with the
  `TemporalWorkflowPicker` form field: it lists workflows by entity, type,
  status and a Bool search attribute, with the permissions of the user
  filling in the form. It needs `@kwkevinchan/backstage-plugin-temporal`.
  The package root exports `TemporalWorkflowPickerFieldExtension` for the
  legacy frontend system; the new frontend system uses `./alpha`.
