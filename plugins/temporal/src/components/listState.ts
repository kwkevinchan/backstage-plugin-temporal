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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { WORKFLOW_STATUSES, WorkflowStatus } from '../common';

/*
 * State of the workflow lists, kept when the user opens a workflow and comes
 * back (browser back or the "All workflows" link):
 *
 * - filters, the page number and the page size are query parameters of the
 *   list URL (`?status=Running&page=2&pageSize=10`), so back and forward,
 *   reloads and shared links keep them;
 * - Temporal's page tokens are opaque and can be long, so the tokens of the
 *   pages seen are kept in sessionStorage, by list path and filters. When
 *   they are gone (another tab, storage blocked), the list opens on the
 *   first page and says so;
 * - the scroll position is kept in sessionStorage by list URL.
 */

/** Page sizes offered by the lists. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;
/** Largest page size the backend accepts. */
const MAX_PAGE_SIZE = 100;

export interface ListFilters {
  status: WorkflowStatus | '';
  allRuns: boolean;
  workflowId: string;
  workflowType: string;
}

export const EMPTY_FILTERS: ListFilters = {
  status: '',
  allRuns: false,
  workflowId: '',
  workflowType: '',
};

const TOKENS_KEY = 'temporal.list.tokens:';
const SEARCH_KEY = 'temporal.list.search:';
const SCROLL_KEY = 'temporal.list.scroll:';

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage full or blocked: the list starts on page 1 next time.
  }
}

function normalPath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

/** Filters, page and page size from the query of a list URL. */
export function readListParams(search: URLSearchParams) {
  const status = search.get('status') ?? '';
  const page = Number(search.get('page') ?? '1');
  const size = Number(search.get('pageSize') ?? DEFAULT_PAGE_SIZE);
  return {
    filters: {
      status: (WORKFLOW_STATUSES as readonly string[]).includes(status)
        ? (status as WorkflowStatus)
        : '',
      allRuns: search.get('allRuns') === 'true',
      workflowId: search.get('workflowId') ?? '',
      workflowType: search.get('workflowType') ?? '',
    } as ListFilters,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize:
      Number.isInteger(size) && size >= 1 && size <= MAX_PAGE_SIZE
        ? size
        : DEFAULT_PAGE_SIZE,
  };
}

/** The query of a list URL, without the defaults. */
export function listSearch(
  filters: ListFilters,
  page: number,
  pageSize: number,
  keep?: URLSearchParams,
): URLSearchParams {
  const search = new URLSearchParams(keep);
  for (const name of [
    'status',
    'allRuns',
    'workflowId',
    'workflowType',
    'page',
    'pageSize',
  ]) {
    search.delete(name);
  }
  if (filters.status) search.set('status', filters.status);
  if (filters.allRuns) search.set('allRuns', 'true');
  if (filters.workflowId) search.set('workflowId', filters.workflowId);
  if (filters.workflowType) search.set('workflowType', filters.workflowType);
  if (page > 1) search.set('page', String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) search.set('pageSize', String(pageSize));
  return search;
}

/**
 * The query string the list at `path` had when it was left, for the
 * "All workflows" link of the details page. Empty when not known.
 */
export function savedListSearch(path: string): string {
  const saved = read(`${SEARCH_KEY}${normalPath(path)}`);
  return saved && saved.startsWith('?') ? saved : '';
}

/** The scrolling element around `element`, or the page. */
function scrollParent(element: HTMLElement | null): HTMLElement | undefined {
  for (let e = element?.parentElement; e; e = e.parentElement) {
    const { overflowY } = window.getComputedStyle(e);
    if (/(auto|scroll)/.test(overflowY) && e.scrollHeight > e.clientHeight) {
      return e;
    }
  }
  return undefined;
}

/**
 * Filters, page and page tokens of a workflow list, in the URL and in
 * sessionStorage. `pageToken` is the token to load the current page with.
 */
export function useWorkflowListState() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { filters, page, pageSize } = readListParams(searchParams);
  const path = normalPath(location.pathname);
  const filterKey = JSON.stringify([
    filters.status,
    filters.allRuns,
    filters.workflowId,
    filters.workflowType,
    pageSize,
  ]);
  const tokensKey = `${TOKENS_KEY}${path}`;
  const readTokens = useCallback((): string[] => {
    try {
      const saved = JSON.parse(read(tokensKey) ?? 'null');
      return saved?.filter === filterKey && Array.isArray(saved.tokens)
        ? saved.tokens.filter((t: unknown) => typeof t === 'string')
        : [];
    } catch {
      return [];
    }
  }, [tokensKey, filterKey]);
  const tokens = readTokens();
  const pageToken = page > 1 ? tokens[page - 2] : undefined;
  const [lostPage, setLostPage] = useState<number>();

  const go = useCallback(
    (next: { filters?: ListFilters; page?: number; pageSize?: number }) => {
      setSearchParams(current =>
        listSearch(
          next.filters ?? filters,
          next.page ?? 1,
          next.pageSize ?? pageSize,
          current,
        ),
      );
    },
    [filters, pageSize, setSearchParams],
  );

  // A page whose token is gone: back to the first page, with a notice.
  useEffect(() => {
    if (page > 1 && pageToken === undefined) {
      setLostPage(page);
      setSearchParams(current => listSearch(filters, 1, pageSize, current), {
        replace: true,
      });
    }
  }, [page, pageToken, filters, pageSize, setSearchParams]);

  // The search of the list, for the "All workflows" link.
  useEffect(() => {
    write(`${SEARCH_KEY}${path}`, location.search || '?');
  }, [path, location.search]);

  return {
    filters,
    page,
    pageSize,
    pageToken,
    lostPage,
    setFilters(next: ListFilters) {
      setLostPage(undefined);
      go({ filters: next });
    },
    setPageSize(next: number) {
      setLostPage(undefined);
      go({ pageSize: next });
    },
    nextPage(token: string | undefined) {
      if (!token) return;
      const kept = readTokens().slice(0, page - 1);
      kept[page - 1] = token;
      write(tokensKey, JSON.stringify({ filter: filterKey, tokens: kept }));
      setLostPage(undefined);
      go({ page: page + 1 });
    },
    previousPage() {
      setLostPage(undefined);
      go({ page: Math.max(1, page - 1) });
    },
  };
}

/**
 * Keeps the scroll position of a list in sessionStorage by its URL, and
 * scrolls back to it once the list has loaded (`ready`).
 */
export function useListScroll(ready: boolean) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const key = `${SCROLL_KEY}${normalPath(location.pathname)}${location.search}`;
  const restored = useRef<string>();

  useEffect(() => {
    if (!ready || restored.current === key) return undefined;
    restored.current = key;
    const saved = Number(read(key));
    if (!Number.isFinite(saved) || saved <= 0) return undefined;
    // The rows of the table are drawn a moment after the data arrives, so
    // the page may not be long enough yet: try again for a few frames.
    let frame = 0;
    let handle: number | undefined;
    const attempt = () => {
      const parent = scrollParent(ref.current);
      if (parent) parent.scrollTop = saved;
      else window.scrollTo?.(0, saved);
      const now = parent ? parent.scrollTop : window.scrollY;
      if (Math.abs(now - saved) > 1 && frame++ < 60) {
        handle = window.requestAnimationFrame(attempt);
      }
    };
    attempt();
    return () => {
      if (handle !== undefined) window.cancelAnimationFrame(handle);
    };
  }, [ready, key]);

  useEffect(() => {
    const parent = scrollParent(ref.current);
    const target: HTMLElement | Window = parent ?? window;
    const save = () =>
      write(key, String(parent ? parent.scrollTop : window.scrollY));
    target.addEventListener('scroll', save, { passive: true });
    return () => target.removeEventListener('scroll', save);
  }, [key, ready]);

  // Also when the list is left (a workflow opened, another page): the
  // position may not have changed since the last scroll event. A layout
  // effect cleans up before the list is removed from the page.
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      const parent = scrollParent(element);
      write(key, String(parent ? parent.scrollTop : window.scrollY));
    };
  }, [key]);

  return ref;
}
