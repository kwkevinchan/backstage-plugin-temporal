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

// The stylesheets are put on the page in the order of these imports, and
// of two rules of the same weight the later one wins: keep the order.
import status from './styles/status.module.css';
import graph from './styles/graph.module.css';
import common from './styles/common.module.css';
import payload from './styles/payload.module.css';
import header from './styles/header.module.css';
import progress from './styles/progress.module.css';
import events from './styles/events.module.css';
import controls from './styles/controls.module.css';
import eventGroups from './styles/eventGroups.module.css';
import timeline from './styles/timeline.module.css';
import stepKinds from './styles/stepKinds.module.css';
import llm from './styles/llm.module.css';
import overview from './styles/overview.module.css';
import type { Tone } from './status';

/**
 * The stylesheets of the plugin, one for each part of it. Every component
 * takes its class names from this file, so that the stylesheets are put on
 * the page together, whichever component is drawn first.
 *
 * Class names are scoped to their stylesheet, and a stylesheet may have
 * rules for a class of another one (`.tp-node.tp-hue[data-group]` in
 * eventGroups, `.tp-node` in graph): an element gets the scoped name of
 * each stylesheet that has rules for its class.
 */
const STYLESHEETS: Record<string, string>[] = [
  status,
  graph,
  common,
  payload,
  header,
  progress,
  events,
  controls,
  eventGroups,
  timeline,
  stepKinds,
  llm,
  overview,
];

const scopedNames = new Map<string, string>();

/** The scoped names of a class, or the name itself when it is no class of the styles. */
function scoped(name: string): string {
  let names = scopedNames.get(name);
  if (names === undefined) {
    const found = new Set<string>();
    for (const stylesheet of STYLESHEETS) {
      const scopedName = stylesheet[name];
      if (scopedName) found.add(scopedName);
    }
    names = found.size > 0 ? [...found].join(' ') : name;
    scopedNames.set(name, names);
  }
  return names;
}

/**
 * Scoped class names of the plugin styles, joined with spaces. A name that
 * is not one of them is returned as it is.
 */
export function tp(...names: string[]): string {
  return names.map(scoped).join(' ');
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
