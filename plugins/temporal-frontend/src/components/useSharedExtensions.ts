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

import { useMemo } from 'react';
import { useApiHolder } from '@backstage/core-plugin-api';
import {
  temporalWorkflowExtensionsApiRef,
  TemporalWorkflowExtensionsApi,
} from '../extensions';

/** Selectors of the lists of the shared workflow extensions API. */
export const sharedExtensions = {
  actions: (api: TemporalWorkflowExtensionsApi) => api.getActions(),
  sections: (api: TemporalWorkflowExtensionsApi) => api.getSections(),
  listActions: (api: TemporalWorkflowExtensionsApi) => api.getListActions(),
  scheduleActions: (api: TemporalWorkflowExtensionsApi) =>
    api.getScheduleActions(),
};

/**
 * The extensions of one kind: the ones passed as props (legacy frontend
 * system) first, then those of the shared workflow extensions API (new
 * frontend system), without a second entry for an id. `select` must be one
 * of {@link sharedExtensions}, so that it is the same function on every
 * render.
 */
export function useSharedExtensions<T extends { id: string }>(
  select: (api: TemporalWorkflowExtensionsApi) => T[],
  own: T[] | undefined,
): T[] {
  const shared = useApiHolder().get(temporalWorkflowExtensionsApiRef);
  return useMemo(() => {
    const all = [...(own ?? []), ...(shared ? select(shared) : [])];
    return all.filter((item, i) => all.findIndex(o => o.id === item.id) === i);
  }, [select, own, shared]);
}
