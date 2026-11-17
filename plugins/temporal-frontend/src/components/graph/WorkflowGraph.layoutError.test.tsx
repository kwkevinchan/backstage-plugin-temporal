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

import { screen, within } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import type { WorkflowGraphResponse } from '../../common';
import { graphResponse } from '../../testData';
import { loopGraph } from '../../testGraphs/loopGraph';
import { layoutSteps } from './layout';
import { layoutGroupedSteps } from './eventGroups';
import { WorkflowGraph } from './WorkflowGraph';

jest.mock('./layout', () => {
  const actual = jest.requireActual('./layout') as typeof import('./layout');
  return {
    ...actual,
    layoutSteps: jest.fn((...args: Parameters<typeof actual.layoutSteps>) =>
      actual.layoutSteps(...args),
    ),
  };
});

jest.mock('./eventGroups', () => {
  const actual = jest.requireActual(
    './eventGroups',
  ) as typeof import('./eventGroups');
  return {
    ...actual,
    layoutGroupedSteps: jest.fn(
      (...args: Parameters<typeof actual.layoutGroupedSteps>) =>
        actual.layoutGroupedSteps(...args),
    ),
  };
});

const actualLayout = jest.requireActual(
  './layout',
) as typeof import('./layout');
const actualGroups = jest.requireActual(
  './eventGroups',
) as typeof import('./eventGroups');

beforeEach(() => {
  jest.mocked(layoutSteps).mockImplementation(actualLayout.layoutSteps);
  jest
    .mocked(layoutGroupedSteps)
    .mockImplementation(actualGroups.layoutGroupedSteps);
});

/**
 * The graph plus the rest of the run page that must stay up when layout
 * throws: the step list and the step details.
 */
function Page(props: { graph: WorkflowGraphResponse }) {
  const steps = props.graph.nodes.filter(n => !n.internal);
  return (
    <div>
      <ul data-testid="step-list">
        {steps.map(n => (
          <li key={n.id}>{n.name}</li>
        ))}
      </ul>
      <WorkflowGraph graph={props.graph} onSelect={() => {}} />
      <section data-testid="step-details">Details of {steps[0]?.name}</section>
    </div>
  );
}

describe('WorkflowGraph layout errors', () => {
  it('shows a message in the graph when layoutSteps throws, and keeps the step list and details', async () => {
    jest.mocked(layoutSteps).mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    await renderInTestApp(<Page graph={graphResponse} />);

    const graph = screen.getByTestId('workflow-graph');
    const alert = within(graph).getByTestId('temporal-error');
    expect(alert).toHaveTextContent('The graph could not be laid out');
    expect(alert).toHaveTextContent('Maximum call stack size exceeded');
    expect(screen.getByTestId('step-list')).toHaveTextContent('Start');
    expect(screen.getByTestId('step-list')).toHaveTextContent('reserveStock');
    expect(screen.getByTestId('step-details')).toHaveTextContent(
      'Details of Start',
    );
  });

  it('shows a message in the graph when layoutGroupedSteps throws, and keeps the step list and details', async () => {
    jest.mocked(layoutGroupedSteps).mockImplementation(() => {
      throw new Error('layout failed');
    });
    await renderInTestApp(<Page graph={loopGraph} />);

    const graph = screen.getByTestId('workflow-graph');
    const alert = within(graph).getByTestId('temporal-error');
    expect(alert).toHaveTextContent('The graph could not be laid out');
    expect(alert).toHaveTextContent('layout failed');
    expect(screen.getByTestId('step-list')).toHaveTextContent('Start');
    expect(screen.getByTestId('step-details')).toHaveTextContent(
      'Details of Start',
    );
  });

  it('still draws the graph when layout succeeds', async () => {
    await renderInTestApp(<Page graph={graphResponse} />);

    expect(
      within(screen.getByTestId('workflow-graph')).queryByTestId(
        'temporal-error',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('workflow-graph')).toBeInTheDocument();
    expect(screen.getByTestId('step-list')).toHaveTextContent('Start');
    expect(screen.getByTestId('step-details')).toHaveTextContent(
      'Details of Start',
    );
  });
});
