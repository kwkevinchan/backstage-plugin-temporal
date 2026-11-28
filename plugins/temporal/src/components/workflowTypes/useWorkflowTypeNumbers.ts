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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { MAX_WORKFLOW_TYPE_OVERVIEW_REFS } from '../../common';
import { OVERVIEW_CACHE_TTL_MS } from '../../common/listLimits';
import { temporalApiRef } from '../../extensions';
import {
  isFailure,
  isOverview,
  readAt,
  RowFailure,
  RowNumbers,
} from './rowNumbers';

/** Numbers older than this are read again when their row comes back. */
const NUMBERS_MAX_AGE_MS = OVERVIEW_CACHE_TTL_MS;

/**
 * The numbers of the runs of the entities on screen (`loaded`): read from
 * the backend a batch at a time, kept while the tab is open and read again
 * when they are old.
 */
export function useWorkflowTypeNumbers(loaded: Entity[]) {
  const temporalApi = useApi(temporalApiRef);
  const [numbers, setNumbers] = useState<Record<string, RowNumbers>>({});
  const refsToRead = useMemo(
    () => loaded.map(e => stringifyEntityRef(e)),
    [loaded],
  );

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Reads the numbers of `refs`, a batch at a time, one batch after another. */
  const read = useCallback(
    async (refs: string[]) => {
      for (let i = 0; i < refs.length; i += MAX_WORKFLOW_TYPE_OVERVIEW_REFS) {
        const batch = refs.slice(i, i + MAX_WORKFLOW_TYPE_OVERVIEW_REFS);
        let result: Record<string, RowNumbers>;
        try {
          const response = await temporalApi.getWorkflowTypeOverview(batch);
          const byRef = new Map(response.items.map(o => [o.entityRef, o]));
          result = Object.fromEntries(
            batch.map(ref => [ref, byRef.get(ref) ?? 'missing']),
          );
        } catch (error) {
          const failure: RowFailure = {
            failure: {
              error: error instanceof Error ? error : new Error(String(error)),
              at: Date.now(),
            },
          };
          result = Object.fromEntries(batch.map(ref => [ref, failure]));
        }
        if (!mounted.current) return;
        setNumbers(current => ({ ...current, ...result }));
      }
    },
    [temporalApi],
  );

  // The numbers of rows that come on screen, unless they were read less
  // than a minute ago (the backend keeps them for a minute too).
  useEffect(() => {
    const stale = Date.now() - NUMBERS_MAX_AGE_MS;
    const missing = refsToRead.filter(ref => {
      const n = numbers[ref];
      return n === undefined || (readAt(n) ?? Infinity) < stale;
    });
    if (missing.length === 0) return;
    setNumbers(current => ({
      ...current,
      ...Object.fromEntries(missing.map(ref => [ref, 'loading' as const])),
    }));
    read(missing);
    // `numbers` is left out on purpose: only new rows start a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsToRead, read]);

  const retry = (ref: string) => {
    setNumbers(current => ({ ...current, [ref]: 'loading' }));
    read([ref]);
  };

  // Rows the user may not read on Temporal's side are left out.
  const readable = loaded.filter(
    e => numbers[stringifyEntityRef(e)] !== 'missing',
  );
  const rows = readable;

  const shown = rows
    .map(e => numbers[stringifyEntityRef(e)])
    .filter(isOverview);
  // The error of the first row whose request failed as a whole; a later
  // batch that works does not hide it.
  const requestError = rows
    .map(e => numbers[stringifyEntityRef(e)])
    .find(isFailure)?.failure.error;
  const rateLimited = shown.some(n => n.error?.rateLimited);
  const oldest = shown
    .filter(n => !n.error)
    .map(n => Date.parse(n.updatedAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [oldest]);

  return { numbers, retry, rows, requestError, rateLimited, oldest, now };
}
