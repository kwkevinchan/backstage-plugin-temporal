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
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
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

  describe('with useAsyncRetry', () => {
    function setupLoader() {
      const resolvers: Array<() => void> = [];
      const load = jest.fn(
        () => new Promise<void>(resolve => resolvers.push(resolve)),
      );
      const hook = renderHook(() => {
        const state = useAsyncRetry(load, []);
        return useRefreshLock(state.retry, state.loading);
      });
      const finishAll = async () => {
        await act(async () => {
          resolvers.splice(0).forEach(resolve => resolve());
          await jest.advanceTimersByTimeAsync(0);
        });
      };
      return { load, finishAll, ...hook };
    }

    async function pass(ms: number) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    }

    it('reloads once however often it is pressed, and unlocks after the load and a second', async () => {
      const { load, finishAll, result } = setupLoader();
      await finishAll();
      expect(load).toHaveBeenCalledTimes(1);

      act(() => result.current.refresh());
      await pass(0);
      expect(load).toHaveBeenCalledTimes(2);
      act(() => result.current.refresh());
      act(() => result.current.refresh());
      expect(load).toHaveBeenCalledTimes(2);

      await pass(REFRESH_LOCK_MS * 3);
      expect(result.current.locked).toBe(true);

      await finishAll();
      expect(result.current.locked).toBe(false);

      act(() => result.current.refresh());
      await pass(0);
      expect(load).toHaveBeenCalledTimes(3);
      await finishAll();
      await pass(REFRESH_LOCK_MS - 1);
      expect(result.current.locked).toBe(true);
      await pass(1);
      expect(result.current.locked).toBe(false);
    });

    it('is not left locked when the press came while a load was running', async () => {
      const { load, finishAll, result } = setupLoader();
      expect(load).toHaveBeenCalledTimes(1);

      act(() => result.current.refresh());
      await pass(REFRESH_LOCK_MS);
      expect(result.current.locked).toBe(true);

      await finishAll();
      expect(result.current.locked).toBe(false);
    });

    it('does not update state or keep the timer after unmount', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { finishAll, result, unmount } = setupLoader();
      await finishAll();
      act(() => result.current.refresh());
      await pass(0);
      expect(jest.getTimerCount()).toBe(1);

      unmount();
      expect(jest.getTimerCount()).toBe(0);
      await finishAll();
      await pass(REFRESH_LOCK_MS * 2);
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
