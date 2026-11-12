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

import { act, render, screen } from '@testing-library/react';
import { useSettledWidth } from './GraphCanvas';

describe('useSettledWidth', () => {
  let callback: (() => void) | undefined;
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    jest.useFakeTimers();
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        callback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.ResizeObserver = original;
    callback = undefined;
  });

  function Probe() {
    const [ref, width] = useSettledWidth(150);
    return (
      <div ref={ref} data-testid="probe">
        {width ?? 'none'}
      </div>
    );
  }

  it('takes the first width at once and later ones once they settle', () => {
    let width = 1000;
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(() => width);
    render(<Probe />);
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveTextContent('1000');

    // The panel opens: the width changes over a few frames.
    const resize = () => {
      callback!();
      jest.advanceTimersByTime(50);
    };
    for (const next of [900, 800, 700]) {
      width = next;
      act(resize);
      expect(probe).toHaveTextContent('1000');
    }
    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(probe).toHaveTextContent('700');
  });

  function PanelProbe(props: { open: boolean }) {
    const [ref, width] = useSettledWidth(150, props.open);
    return (
      <div ref={ref} data-testid="panel-probe">
        {width ?? 'none'}
      </div>
    );
  }

  it('reads the width at once when the step panel opens or closes', () => {
    let width = 1000;
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(() => width);
    const { rerender } = render(<PanelProbe open={false} />);
    const probe = screen.getByTestId('panel-probe');
    expect(probe).toHaveTextContent('1000');
    // The panel takes its width in the same render: no delay, no timer.
    width = 700;
    rerender(<PanelProbe open />);
    expect(probe).toHaveTextContent('700');
    width = 1000;
    rerender(<PanelProbe open={false} />);
    expect(probe).toHaveTextContent('1000');
  });
});
