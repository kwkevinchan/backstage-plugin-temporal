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
 * the workflow graph canvas and its layout, node status helpers, panels and
 * the class names of the plugin styles. An app does not need them.
 *
 * Alpha: there is no compatibility promise between versions. The companion
 * packages are released with the same version as this plugin and use the
 * matching `./ui`; other packages should not depend on it.
 *
 * @packageDocumentation
 */

export type {
  GraphCanvasProps,
  GraphFullscreen,
} from './components/graph/GraphCanvas';
export type { NodeSize, StepLayout } from './components/graph/layout';
export type { AnyStatus, Tone } from './components/WorkflowStatusLabel';
export { tp } from './components/styles';
export { ErrorAlert, Loading } from './components/feedback';
export { PanelCard } from './components/PanelCard';
export { DefinitionList } from './components/StepDrawer';
export {
  isActiveStatus,
  statusLabel,
  statusTone,
} from './components/WorkflowStatusLabel';
export { workflowLink } from './components/WorkflowRunsTable';
export { graphHeight, layoutSteps } from './components/graph/layout';
export {
  flowNodeBase,
  GraphCanvas,
  GraphFullscreenContext,
  useGraphFullscreen,
  useGraphFullscreenState,
  RELAYOUT_DELAY_MS,
  useSettledWidth,
  ViewButtons,
} from './components/graph/GraphCanvas';
