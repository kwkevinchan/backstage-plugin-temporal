---
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-frontend': minor
'@kwkevinchan/backstage-plugin-temporal-module-zigflow': patch
'@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal': patch
'@kwkevinchan/backstage-plugin-temporal-backend-module-actions': patch
---

Settle the public interfaces before the first release. Breaking changes, and what to change:

- `temporal-backend`: the workflow enricher extension point is removed (`temporalWorkflowEnricherExtensionPoint`, `TemporalWorkflowEnricher`, `TemporalWorkflowEnricherContext`, `TemporalWorkflowEnricherExtensionPoint`), and with it the `extensions` field of `WorkflowSummary`. Show data of your own with a tab or a button that reads it through your own backend route.
- `temporal-backend`: `GET /api/temporal/openapi.json` is removed. Register an `API` entity that reads `src/schema/openapi.yaml` of the version you run (see the backend README). `yaml` is no longer a runtime dependency.
- `temporal-backend`: the `temporal-workflow` permission resource has no `getResources`, so `apply-conditions` answers `501` for it, and `stringifyTemporalWorkflowResourceRef` and `parseTemporalWorkflowResourceRef` are removed from `./common`. Another plugin calls the HTTP API as the user instead.
- `./common` (both core packages): `temporalWorkflowEntityV1alpha1Schema`, `temporalWorkflowMessageSchema` and `NAME_PATTERN_SOURCES` are no longer exported; the catalog module validates the kind. Use `isValidNamespaceName`, `isValidTaskQueueName` and `isValidWorkflowTypeName` for the names.
- `./common`: `WorkflowDetail.executionTime`, `WorkflowDetail.parent.namespace` (a namespace ID) and `TemporalScheduleAction.scheduledAt` are removed. `WorkflowControlOperation` no longer has `query` (a query is not an operation; the path is `buildWorkflowRunPath(ref)` + `/query`). `WorkflowToolLink` (experimental) is renamed `WorkflowLlmToolLink`.
- HTTP API: the workflow ID prefix of `GET /workflows` is the query parameter `workflowIdPrefix` (was `workflowId`). `TemporalApi.listWorkflows` takes `workflowIdPrefix` as before.
- `temporal-backend/node`: `TemporalService.getAllowedNamespaces()` is removed; use `isNamespaceAllowed()`. `getConnection()` takes `{ namespace? }`, and `getClient({ namespace })` must make its client on `getConnection({ namespace })`, or calls of custom actions run without a deadline. `DefaultTemporalService`, `readTemporalServiceOptions`, `TemporalServiceOptions` and `TemporalConnectionAuth` are exported: for client certificates, extend `DefaultTemporalService` and override `getConnection` and `close`.
- `temporal-backend/alpha`: `TemporalAccessService.linkWorkflowEntities` is removed. A custom access service no longer implements it; the plugin links runs to the entity of their workflow type itself.
- `temporal-backend/node`: `buildWorkflowUrl` takes `{ pagePath }`. The new key `temporal.pagePath` (default `/temporal`) sets where the app mounts the Temporal page, for the `workflowUrl` of the Scaffolder and actions registry modules.
- `temporal-frontend`: `useTemporalWorkflow` and `TemporalWorkflowProvider` are removed; components get the same `TemporalWorkflowExtensionProps` as props. `@backstage/version-bridge` is no longer a dependency. New methods of `TemporalApi` come in minor versions; to replace the API, extend `TemporalClient`.
- `temporal-frontend/ui` (alpha): `StepLayout` keeps `positions`, `sizes`, `width`, `height` and `wrapped`; `GraphCanvasProps` has no `focusId` or `selectable`. `GraphFullscreenArea`, `GraphFullscreenButton` and `useIsGraphFullscreen` replace `GraphFullscreen`, `GraphFullscreenContext`, `useGraphFullscreenState`, `useGraphFullscreen` and `ViewButtons`; `useSettledWidth(trigger?)` has no delay argument and `RELAYOUT_DELAY_MS` is removed; `tp` takes only the classes of `TemporalUiClassName`. A change that breaks `./ui` comes only in a minor version while the plugin is `0.x`.
- `temporal-module-zigflow`: uses the narrowed `./ui`; the Definition tab looks the same.
