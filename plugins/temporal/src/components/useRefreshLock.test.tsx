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

import { act, renderHook } from '@testing-library/react';
import { REFRESH_LOCK_MS, useRefreshLock } from './useRefreshLock';

describe('useRefreshLock', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup() {
    const reload = jest.fn();
    const hook = renderHook(({ loading }) => useRefreshLock(reload, loading), {
      initialProps: { loading: false },
    });
    return { reload, ...hook };
  }

  it('reloads once however often the button is pressed', () => {
    const { reload, result } = setup();
    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(result.current.locked).toBe(true);
    act(() => result.current.refresh());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays locked for a second after a reload that ended at once', () => {
    const { reload, result, rerender } = setup();
    act(() => result.current.refresh());
    rerender({ loading: true });
    rerender({ loading: false });
    act(() => {
      jest.advanceTimersByTime(REFRESH_LOCK_MS - 1);
    });
    expect(result.current.locked).toBe(true);
    act(() => result.current.refresh());
    expect(reload).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.locked).toBe(false);
    act(() => result.current.refresh());
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('stays locked until a reload that takes longer has ended', () => {
    const { reload, result, rerender } = setup();
    act(() => result.current.refresh());
    rerender({ loading: true });
    act(() => {
      jest.advanceTimersByTime(REFRESH_LOCK_MS * 5);
    });
    expect(result.current.locked).toBe(true);
    act(() => result.current.refresh());
    expect(reload).toHaveBeenCalledTimes(1);

    rerender({ loading: false });
    expect(result.current.locked).toBe(false);
  });

  it('unlocks after a second when the reload loads nothing', () => {
    const { result } = setup();
    act(() => result.current.refresh());
    act(() => {
      jest.advanceTimersByTime(REFRESH_LOCK_MS);
    });
    expect(result.current.locked).toBe(false);
  });
});
