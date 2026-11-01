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

import { graphResponse } from '../../testData';
import { layoutSteps, NODE_WIDTH, visibleSteps } from './layout';

describe('layoutSteps', () => {
  it('lays out steps left to right and leaves out internal steps', () => {
    const { nodes, edges } = visibleSteps(
      graphResponse.nodes,
      graphResponse.edges,
    );
    expect(nodes.map(n => n.id)).not.toContain('workflowTask-2');
    const positions = layoutSteps(nodes, edges);
    const xs = ['start', 'activity-5', 'activity-11', 'end'].map(
      id => positions.get(id)!.x,
    );
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('puts parallel steps in the same column', () => {
    const node = (id: string) => ({
      id,
      kind: 'activity' as const,
      name: id,
      status: 'Completed' as const,
      events: [],
    });
    const nodes = ['start', 'a', 'b', 'end'].map(node);
    const edges = [
      ['start', 'a'],
      ['start', 'b'],
      ['a', 'end'],
      ['b', 'end'],
    ].map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
    }));
    const positions = layoutSteps(nodes, edges);
    expect(positions.get('a')!.x).toBe(positions.get('b')!.x);
    expect(positions.get('a')!.y).not.toBe(positions.get('b')!.y);
  });
});
