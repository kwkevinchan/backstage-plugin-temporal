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
 * this plugin, such as `@kwkevinchan/backstage-plugin-temporal-module-zigflow`
 * and `-module-control`: the workflow graph canvas and its layout, node
 * status helpers, panels, the dialogs and fields of workflow operations and
 * the class names of the plugin styles. They follow the plugin version; an
 * app does not need them.
 *
 * @packageDocumentation
 */

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
  RELAYOUT_DELAY_MS,
  useSettledWidth,
  ViewButtons,
} from './components/graph/GraphCanvas';
export { JsonView } from './components/PayloadView';
export {
  controlError,
  JsonArgsField,
  parseArgs,
  useControlPermission,
  WithReason,
} from './components/controls/shared';
export {
  MessageDialog,
  PermissionButton,
  useWorkflowHandlers,
} from './components/controls/MessageDialog';
export type { MessageDialogText } from './components/controls/MessageDialog';
