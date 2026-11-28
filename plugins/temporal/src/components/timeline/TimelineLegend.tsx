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

import { tp } from '../styles';

/** What the shapes and the colors of the bars mean. */
export function TimelineLegend(props: { groups?: boolean }) {
  const item = (cls: string, text: string, tone = 'tp-tone-success') => (
    <span className={tp('tp-tl-legend-item')}>
      <span className={tp('tp-tl-legend-swatch', cls, tone)} aria-hidden />
      {text}
    </span>
  );
  return (
    <div className={tp('tp-tl-legend')} aria-label="Legend">
      {item('tp-tl-legend-queued', 'Queued')}
      {item('tp-tl-legend-run', 'Running or done')}
      {item('tp-tl-legend-run', 'Failed', 'tp-tone-danger')}
      {item('tp-tl-legend-wait', 'Timer or wait', 'tp-tone-neutral')}
      {item('tp-tl-legend-point', 'Signal or update', 'tp-tone-info')}
      {props.groups && item('tp-tl-legend-round', 'Collapsed group')}
    </div>
  );
}
