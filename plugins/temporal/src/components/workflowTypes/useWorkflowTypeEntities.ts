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

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseEntityRef } from '@backstage/catalog-model';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/esm/useAsync';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import {
  MAX_WORKFLOW_TYPE_OVERVIEW_REFS,
  TEMPORAL_WORKFLOW_KIND,
} from '../../common';

/** Rows on one page of the Workflows tab. */
const WORKFLOW_TYPES_PAGE_SIZE = MAX_WORKFLOW_TYPE_OVERVIEW_REFS;

/** The owner filter: the groups of the user, or every owner. */
export const MINE = 'mine';
export const ALL = 'all';

/** The order of the rows; the catalog sorts them, by name only. */
export interface Sort {
  column: 'name';
  direction: 'ascending' | 'descending';
}

const ENTITY_FIELDS = [
  'kind',
  'metadata.namespace',
  'metadata.name',
  'metadata.title',
  'metadata.description',
  'metadata.tags',
  'spec',
  'relations',
];

/**
 * The rows of the Workflows tab: the filters in the URL, the order, and the
 * page of `TemporalWorkflow` entities that the catalog returns for them.
 */
export function useWorkflowTypeEntities() {
  const catalogApi = useApi(catalogApiRef);
  const identityApi = useApi(identityApiRef);
  const [searchParams, setSearchParams] = useSearchParams();

  const groups = useAsync(async () => {
    const identity = await identityApi.getBackstageIdentity();
    return identity.ownershipEntityRefs.filter(ref => {
      try {
        return parseEntityRef(ref).kind.toLocaleLowerCase('en-US') === 'group';
      } catch {
        return false;
      }
    });
  }, [identityApi]);
  const myGroups = groups.value ?? [];
  // My teams by default; all owners for a user of no group.
  const owner = searchParams.get('owner') ?? (myGroups.length > 0 ? MINE : ALL);
  const system = searchParams.get('system') ?? '';
  const lifecycle = searchParams.get('lifecycle') ?? '';
  const name = searchParams.get('q') ?? '';
  const [draftName, setDraftName] = useState(name);
  useEffect(() => setDraftName(name), [name]);

  const setParam = (key: string, value: string | undefined) =>
    setSearchParams(
      current => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const [sort, setSort] = useState<Sort>({
    column: 'name',
    direction: 'ascending',
  });
  /** Cursors of the pages before the current one, and the current one. */
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  const facets = useAsync(
    () =>
      catalogApi.getEntityFacets({
        filter: { kind: TEMPORAL_WORKFLOW_KIND },
        facets: ['relations.ownedBy', 'relations.partOf', 'spec.lifecycle'],
      }),
    [catalogApi],
  );

  const filterKey = JSON.stringify([
    owner,
    owner === MINE ? myGroups : [],
    system,
    lifecycle,
    name,
  ]);
  useEffect(() => {
    setCursors([undefined]);
  }, [filterKey, sort.direction]);
  const cursor = cursors[cursors.length - 1];

  const entities = useAsyncRetry(async () => {
    if (groups.loading) return undefined;
    if (cursor) {
      return catalogApi.queryEntities({
        cursor,
        limit: WORKFLOW_TYPES_PAGE_SIZE,
        fields: ENTITY_FIELDS,
      });
    }
    const filter: Record<string, string | string[]> = {
      kind: TEMPORAL_WORKFLOW_KIND,
    };
    if (owner === MINE) filter['relations.ownedBy'] = myGroups;
    else if (owner !== ALL) filter['relations.ownedBy'] = owner;
    if (system) filter['relations.partOf'] = system;
    if (lifecycle) filter['spec.lifecycle'] = lifecycle;
    return catalogApi.queryEntities({
      filter,
      limit: WORKFLOW_TYPES_PAGE_SIZE,
      orderFields: {
        field: 'metadata.name',
        order: sort.direction === 'descending' ? 'desc' : 'asc',
      },
      fullTextFilter: name
        ? { term: name, fields: ['metadata.name', 'metadata.title'] }
        : undefined,
      fields: ENTITY_FIELDS,
    });
  }, [catalogApi, groups.loading, filterKey, sort.direction, cursor]);

  const loaded = useMemo(() => entities.value?.items ?? [], [entities.value]);

  return {
    filters: {
      owner,
      system,
      lifecycle,
      myGroups,
      draftName,
      setDraftName,
      setParam,
      facets: facets.value?.facets,
    },
    sort,
    setSort,
    /** The entities of the page. */
    loaded,
    error: entities.error,
    pending: groups.loading || entities.loading,
    /** The number of the page, from 1. */
    page: cursors.length,
    nextCursor: entities.value?.pageInfo.nextCursor,
    setCursors,
  };
}

/** The filters of the Workflows tab and what sets them. */
export type WorkflowTypeFilters = ReturnType<
  typeof useWorkflowTypeEntities
>['filters'];
