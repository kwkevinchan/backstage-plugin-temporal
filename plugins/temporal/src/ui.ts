/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Building blocks of the Temporal plugin pages for companion packages of
 * this plugin, such as `@kwkevinchan/backstage-plugin-temporal-module-zigflow`:
 * the workflow graph canvas and its layout, node status helpers, panels,
 * the class names of the plugin styles and the entity tab route ref. An app does
 * not need them.
 *
 * Alpha: a change that breaks a user of `./ui` never comes in a patch, only
 * in a version that a `^` range does not take (a minor version while the
 * plugin is `0.x`), so a companion package that depends on `^` of this
 * plugin keeps working. The companion packages are released with the
 * same version as this plugin; other packages should not depend on it.
 *
 * @packageDocumentation
 */

export type { GraphCanvasProps } from './components/graph/GraphCanvas';
export type { NodeSize, StepLayout } from './components/graph/layout';
export type { AnyStatus, Tone } from './components/status';
export type { TemporalUiClassName } from './components/styles';
export { uiClassNames as tp } from './components/styles';
export { AUTO_REFRESH_MS, usePageVisible } from './components/useWorkflowData';
export { ErrorAlert, Loading } from './components/feedback';
export { PanelCard } from './components/PanelCard';
export { DefinitionList } from './components/StepDrawer';
export { isActiveStatus, statusLabel, statusTone } from './components/status';
export { entityContentRouteRef } from './routes';
export { workflowLink } from './components/WorkflowRunsTable';
export { graphHeight, layoutSteps } from './components/graph/layout';
export {
  flowNodeBase,
  GraphCanvas,
  GraphFullscreenArea,
  GraphFullscreenButton,
  useIsGraphFullscreen,
  useSettledWidth,
} from './components/graph/GraphCanvas';
