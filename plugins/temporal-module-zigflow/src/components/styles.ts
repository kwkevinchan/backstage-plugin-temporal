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

import {
  tp as coreClassNames,
  TemporalUiClassName,
} from '@kwkevinchan/backstage-plugin-temporal/ui';
import styles from './zigflow.module.css';

/** The classes of the Temporal plugin styles this package uses. */
const CORE_CLASS_NAMES: ReadonlySet<string> = new Set<TemporalUiClassName>([
  'tp-graph',
  'tp-graph-column',
  'tp-graph-toolbar',
  'tp-graph-canvas',
  'tp-node',
  'tp-node-icon',
  'tp-node-title',
  'tp-node-sub',
  'tp-handle',
  'tp-badge',
  'tp-tone-success',
  'tp-tone-danger',
  'tp-tone-warning',
  'tp-tone-info',
  'tp-tone-neutral',
]);

/**
 * Class names for the elements of this package: the class of the Temporal
 * plugin styles and the class of this package's styles, when there is one.
 * Rules of zigflow.module.css that combine classes (`.tp-node[data-dimmed]`)
 * then match the elements as well.
 */
export function tp(...names: string[]): string {
  return names
    .map(name => {
      const own = styles[name];
      const core = CORE_CLASS_NAMES.has(name)
        ? coreClassNames(name as TemporalUiClassName)
        : name;
      return own ? `${core} ${own}` : core;
    })
    .join(' ');
}
