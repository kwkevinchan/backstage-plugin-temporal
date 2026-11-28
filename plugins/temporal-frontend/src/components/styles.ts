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

import styles from './temporal.module.css';
import type { Tone } from './WorkflowStatusLabel';

/**
 * Scoped class names of the plugin styles, joined with spaces. A name that
 * is not one of them is returned as it is.
 */
export function tp(...names: string[]): string {
  return names.map(name => styles[name] ?? name).join(' ');
}

/**
 * The classes of the plugin styles that companion packages may use: the
 * graph area, the boxes of a graph and their tones.
 *
 * @alpha
 */
export type TemporalUiClassName =
  | 'tp-graph'
  | 'tp-graph-column'
  | 'tp-graph-toolbar'
  | 'tp-graph-canvas'
  | 'tp-node'
  | 'tp-node-icon'
  | 'tp-node-title'
  | 'tp-node-sub'
  | 'tp-handle'
  | 'tp-badge'
  | `tp-tone-${Tone}`;

/**
 * Scoped class names of {@link TemporalUiClassName}, joined with spaces.
 *
 * @alpha
 */
export const uiClassNames: (...names: TemporalUiClassName[]) => string = tp;
