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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { themes, UnifiedThemeProvider } from '@backstage/theme';
import { graphResponse } from '../testData';
import { WorkflowGraph } from './graph/WorkflowGraph';
import { StepDrawer } from './StepDrawer';

describe('light and dark themes', () => {
  it('takes every color of the plugin styles from theme tokens', () => {
    const css = readFileSync(join(__dirname, 'temporal.module.css'), 'utf8')
      // Comments may name colors.
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // No fixed colors: they would not change with the theme.
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    expect(css).not.toMatch(/:\s*(white|black)\b/i);
    // Colors of the graph library come from the @backstage/ui tokens.
    for (const variable of [
      '--xy-background-color',
      '--xy-edge-stroke',
      '--xy-controls-button-background-color',
      '--xy-controls-button-color',
    ]) {
      expect(css).toMatch(new RegExp(`${variable}: var\\(--bui-`));
    }
  });

  it.each([
    ['light', themes.light],
    ['dark', themes.dark],
  ])(
    'renders the graph and the step panel in the %s theme',
    async (mode, theme) => {
      const onSelect = jest.fn();
      const step = graphResponse.nodes.find(n => n.id === 'activity-11')!;
      const { container } = render(
        <UnifiedThemeProvider theme={theme}>
          <WorkflowGraph graph={graphResponse} onSelect={onSelect} />
          <StepDrawer
            step={step}
            payloadsHidden={false}
            workflowHref={() => '/x'}
            onClose={() => {}}
          />
        </UnifiedThemeProvider>,
      );
      expect(document.body).toHaveAttribute('data-theme-mode', mode);
      const graph = screen.getByTestId('workflow-graph');
      const failed = within(graph).getByRole('button', {
        name: 'chargeCard, Failed, attempt 2',
      });
      // The status color is a token class, the same in both themes.
      expect(failed).toHaveClass('tp-node', 'tp-tone-danger');
      expect(
        within(graph).getByRole('button', { name: 'reserveStock, Completed' }),
      ).toHaveClass('tp-tone-success');
      // No inline colors anywhere in the plugin markup.
      for (const element of Array.from(
        container.querySelectorAll<HTMLElement>('[style]'),
      )) {
        expect(element.style.color).toBe('');
        expect(element.style.backgroundColor).toBe('');
      }
      fireEvent.click(failed);
      expect(onSelect).toHaveBeenCalledWith('activity-11');
      expect(screen.getByTestId('step-error')).toHaveTextContent(
        'Card declined',
      );
    },
  );
});
