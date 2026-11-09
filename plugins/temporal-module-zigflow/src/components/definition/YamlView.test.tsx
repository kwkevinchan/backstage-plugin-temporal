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

import { fireEvent, render } from '@testing-library/react';
import { YamlView } from './YamlView';

/** The numbers of the rendered lines that carry a mark class. */
function markedLines(yaml: HTMLElement, mark: string): number[] {
  return [...yaml.querySelectorAll<HTMLElement>('[data-line]')]
    .filter(line => line.className.split(/\s+/).includes(mark))
    .map(line => Number(line.getAttribute('data-line')));
}

describe('YamlView', () => {
  it('replaces the document and puts the marks on the new lines', () => {
    const onLineSelect = jest.fn();
    const { getByTestId, rerender } = render(
      <YamlView
        content={'a: 1\nb: 2\nc: 3'}
        highlight={{ startLine: 2, endLine: 3 }}
        cursorLine={2}
        onLineSelect={onLineSelect}
      />,
    );
    const yaml = getByTestId('definition-yaml');
    expect(markedLines(yaml, 'tp-yaml-band')).toEqual([2, 3]);

    rerender(
      <YamlView
        content={'x: 1\ny: 2\nz: 3\nw: 4'}
        highlight={{ startLine: 3, endLine: 4 }}
        cursorLine={4}
        errorLine={1}
        onLineSelect={onLineSelect}
      />,
    );
    expect(yaml).toHaveTextContent('w: 4');
    expect(yaml.querySelectorAll('[data-line]')).toHaveLength(4);
    expect(markedLines(yaml, 'tp-yaml-band')).toEqual([3, 4]);
    expect(markedLines(yaml, 'tp-yaml-cursor')).toEqual([4]);
    expect(markedLines(yaml, 'tp-yaml-error')).toEqual([1]);
    expect(getByTestId('definition-yaml-band')).toHaveAttribute(
      'data-line',
      '3',
    );

    // Marks outside the document are dropped, not drawn on a wrong line.
    rerender(
      <YamlView
        content={'x: 1\ny: 2'}
        highlight={{ startLine: 9, endLine: 10 }}
        cursorLine={9}
        errorLine={9}
        onLineSelect={onLineSelect}
      />,
    );
    expect(
      yaml.querySelector('[data-testid="definition-yaml-band"]'),
    ).toBeNull();
    expect(markedLines(yaml, 'tp-yaml-cursor')).toEqual([]);
    expect(markedLines(yaml, 'tp-yaml-error')).toEqual([]);
  });

  it('selects the line of a line number', () => {
    const onLineSelect = jest.fn();
    const { getByTestId } = render(
      <YamlView content={'a: 1\nb: 2\nc: 3'} onLineSelect={onLineSelect} />,
    );
    // The gutter is outside the lines: the line comes from the height.
    // jsdom has no layout, so the top of the editor is the first line.
    fireEvent.click(
      getByTestId('definition-yaml').querySelector('.cm-lineNumbers')!,
      {
        clientY: 0,
      },
    );
    expect(onLineSelect).toHaveBeenCalledWith(1);
  });

  it('selects a pressed line', () => {
    const onLineSelect = jest.fn();
    const { getByTestId } = render(
      <YamlView content={'a: 1\nb: 2\nc: 3'} onLineSelect={onLineSelect} />,
    );
    fireEvent.click(
      getByTestId('definition-yaml').querySelector('[data-line="2"]')!,
    );
    expect(onLineSelect).toHaveBeenCalledWith(2);
  });

  it('names the editor for assistive technology', () => {
    const { container } = render(
      <YamlView content="a: 1" onLineSelect={jest.fn()} />,
    );
    expect(container.querySelectorAll('[role="textbox"]')).toHaveLength(1);
    const textbox = container.querySelector('[role="textbox"]');
    expect(textbox).toHaveAttribute('aria-label', 'Workflow definition');
    expect(textbox).toHaveAttribute('aria-readonly', 'true');
    // The textbox itself takes the focus and the arrow keys.
    expect(textbox).toHaveAttribute('tabindex', '0');
  });
});
