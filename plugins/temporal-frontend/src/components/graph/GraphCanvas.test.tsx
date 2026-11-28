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

import { waitFor } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import type { WorkflowGraphResponse } from '../../common';
import { graphResponse } from '../../testData';
import { WorkflowGraph } from './WorkflowGraph';

/** `graphResponse` with the ID of a step replaced. */
function withStepId(from: string, to: string): WorkflowGraphResponse {
  const rename = (id: string) => (id === from ? to : id);
  return {
    ...graphResponse,
    nodes: graphResponse.nodes.map(n => ({ ...n, id: rename(n.id) })),
    edges: graphResponse.edges.map(e => ({
      ...e,
      source: rename(e.source),
      target: rename(e.target),
    })),
  };
}

describe('GraphCanvas', () => {
  const original = Element.prototype.scrollIntoView;
  let scrolled: Element[];

  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it.each([
    ['a newline', 'activity-5\nx'],
    ['a carriage return and a form feed', 'activity-5\r\fx'],
    ['quotes, a backslash and brackets', 'activity-5"]\\[x'],
  ])('scrolls to a selected box whose ID has %s', async (_, id) => {
    await renderInTestApp(
      <WorkflowGraph
        graph={withStepId('activity-5', id)}
        selectedId={id}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect(scrolled[0].getAttribute('data-id')).toBe(id);
  });

  it('shows the React Flow attribution, apart from the view buttons', async () => {
    await renderInTestApp(
      <WorkflowGraph graph={graphResponse} onSelect={() => {}} />,
    );
    const attribution = document.querySelector('.react-flow__attribution');
    expect(attribution).not.toBeNull();
    expect(attribution).toHaveClass('bottom', 'left');
    expect(attribution!.querySelector('a')).toHaveAttribute(
      'href',
      expect.stringContaining('reactflow.dev'),
    );
    expect(document.querySelector('.react-flow__controls')).toHaveClass(
      'bottom',
      'right',
    );
  });
});
