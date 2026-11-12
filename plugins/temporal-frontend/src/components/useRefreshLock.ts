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

import { useCallback, useEffect, useRef, useState } from 'react';

/** Shortest time a Refresh button stays locked after a press. */
export const REFRESH_LOCK_MS = 1000;

/**
 * Lock of a Refresh button, so that pressing it again and again does not
 * send a request each time. A press reloads and locks the button until the
 * reload has ended and at least a second has passed; presses while it is
 * locked are ignored.
 *
 * `loading` is true while the data of the button is being loaded.
 */
export function useRefreshLock(
  reload: () => void,
  loading: boolean,
): { locked: boolean; refresh: () => void } {
  // Locked while either is true: `holding` for the first second after a
  // press, `waiting` until the reload of that press has ended.
  const [holding, setHolding] = useState(false);
  const [waiting, setWaiting] = useState(false);
  // Read by `refresh`, so that two presses before the next render count as
  // one.
  const lockedRef = useRef(false);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!loading) setWaiting(false);
  }, [loading]);
  useEffect(() => {
    lockedRef.current = holding || waiting;
  }, [holding, waiting]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const refresh = useCallback(() => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setHolding(true);
    setWaiting(true);
    reload();
    timer.current = window.setTimeout(() => {
      setHolding(false);
      // A reload that never started loading has nothing to wait for.
      if (!loadingRef.current) setWaiting(false);
    }, REFRESH_LOCK_MS);
  }, [reload]);

  return { locked: holding || waiting, refresh };
}
