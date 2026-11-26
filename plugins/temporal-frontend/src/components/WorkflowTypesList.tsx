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
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Entity,
  parseEntityRef,
  RELATION_DEPENDENCY_OF,
  RELATION_OWNED_BY,
  RELATION_PART_OF,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import {
  identityApiRef,
  useApi,
  useRouteRef,
} from '@backstage/core-plugin-api';
import {
  catalogApiRef,
  EntityRefLink,
  EntityRefLinks,
  entityRouteParams,
  entityRouteRef,
  getEntityRelations,
  humanizeEntityRef,
} from '@backstage/plugin-catalog-react';
import {
  Alert,
  Button,
  ButtonIcon,
  Cell,
  Column,
  Flex,
  Link,
  Menu,
  MenuItem,
  MenuTrigger,
  Row,
  SearchField,
  Select,
  Skeleton,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { RiRefreshLine } from '@remixicon/react';
import useAsync from 'react-use/esm/useAsync';
import useAsyncRetry from 'react-use/esm/useAsyncRetry';
import {
  MAX_WORKFLOW_TYPE_OVERVIEW_REFS,
  TEMPORAL_WORKFLOW_KIND,
  WorkflowTypeOverview,
  WorkflowTypeOverviewRun,
} from '../common';
import { temporalApiRef } from '../extensions';
import { ErrorAlert } from './feedback';
import { formatMilliseconds, formatTime } from './format';
import { PanelCard } from './PanelCard';
import { tp } from './styles';
import { useTemporalDefaultNamespace } from './webUi';
import { Pager, workflowLink } from './WorkflowRunsTable';
import { WorkflowStatusLabel } from './WorkflowStatusLabel';

/** Rows on one page of the Workflows tab. */
export const WORKFLOW_TYPES_PAGE_SIZE = 25;
/**
 * Most rows that can be sorted by the latest run: the numbers of every row
 * are loaded first, in batches of {@link MAX_WORKFLOW_TYPE_OVERVIEW_REFS}.
 */
export const MAX_ROWS_SORTED_BY_LATEST_RUN = 50;
/** Numbers older than this are read again when their row comes back. */
const NUMBERS_MAX_AGE_MS = 60_000;

export const COUNTS_HELP =
  'Running now / completed in the last 7 days / failed, timed out or terminated in the last 7 days. ' +
  "Approximate: Temporal's visibility store is eventually consistent, and the numbers are up to a minute old.";
const LATEST_RUN_SORT_HELP = `Sorting by the latest run needs ${MAX_ROWS_SORTED_BY_LATEST_RUN} workflows or fewer: narrow the filters.`;

const MINE = 'mine';
const ALL = 'all';
const ANY = 'any';

type SortColumn = 'name' | 'latestRun';
interface Sort {
  column: SortColumn;
  direction: 'ascending' | 'descending';
}

type Optional = 'lifecycle' | 'source' | 'usedBy' | 'tags';
const OPTIONAL_COLUMNS: { id: Optional; title: string }[] = [
  { id: 'lifecycle', title: 'Lifecycle' },
  { id: 'source', title: 'Namespace / Task queue' },
  { id: 'usedBy', title: 'Used by' },
  { id: 'tags', title: 'Tags' },
];

/** The numbers of a row: loading, read (maybe with an error), or not readable. */
type RowNumbers = WorkflowTypeOverview | 'loading' | 'missing';

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

/** Keeps a press on a link in a row from also opening the row. */
const stop = (e: SyntheticEvent) => e.stopPropagation();
function Inner(props: { children: ReactNode }) {
  return (
    <span
      role="presentation"
      onPointerDown={stop}
      onClick={stop}
      onKeyDown={stop}
    >
      {props.children}
    </span>
  );
}

function agoText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

function refLabel(ref: string, defaultKind: string): string {
  try {
    return humanizeEntityRef(parseEntityRef(ref), { defaultKind });
  } catch {
    return ref;
  }
}

function RunLink(props: { run: WorkflowTypeOverviewRun; time?: string }) {
  return (
    <Inner>
      <Link
        href={workflowLink(props.run)}
        variant="body-small"
        color="info"
        title={props.run.workflowId}
      >
        {formatTime(props.time ?? props.run.startTime) || props.run.workflowId}
      </Link>
    </Inner>
  );
}

function Counts(props: { overview: WorkflowTypeOverview }) {
  const { running, completed, failed } = props.overview;
  const tone = (value: number, active: string) =>
    tp('tp-overview-count', value > 0 ? active : 'tp-tone-neutral');
  return (
    <span
      className={tp('tp-overview-counts')}
      title={COUNTS_HELP}
      data-testid="overview-counts"
    >
      <span className={tone(running, 'tp-tone-info')}>{running}</span>
      {' / '}
      <span className={tone(completed, 'tp-tone-success')}>{completed}</span>
      {' / '}
      <span className={tone(failed, 'tp-tone-danger')}>{failed}</span>
    </span>
  );
}

interface ColumnDef {
  id: string;
  title: string;
  help?: string;
  sortable?: boolean;
  cell(entity: Entity, numbers: RowNumbers | undefined): ReactNode;
}

/**
 * The Workflows tab of the Temporal page: one row for each
 * `TemporalWorkflow` entity the user can read, with the numbers of its
 * runs. The rows come from the catalog, one page at a time; the numbers of
 * a page are read from the backend in one request.
 */
export function WorkflowTypesList() {
  const catalogApi = useApi(catalogApiRef);
  const identityApi = useApi(identityApiRef);
  const temporalApi = useApi(temporalApiRef);
  const navigate = useNavigate();
  const entityRoute = useRouteRef(entityRouteRef);
  const defaultNamespace = useTemporalDefaultNamespace();
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
  const [columns, setColumns] = useState<Set<Optional>>(new Set());
  /** Cursors of the pages before the current one, and the current one. */
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  /** The page shown when every row is loaded (sorted by the latest run). */
  const [localPage, setLocalPage] = useState(0);

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
  const byLatestRun = sort.column === 'latestRun';
  useEffect(() => {
    setCursors([undefined]);
    setLocalPage(0);
  }, [filterKey, sort.column, sort.direction]);
  const cursor = byLatestRun ? undefined : cursors[cursors.length - 1];

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
      limit: byLatestRun
        ? MAX_ROWS_SORTED_BY_LATEST_RUN
        : WORKFLOW_TYPES_PAGE_SIZE,
      orderFields: {
        field: 'metadata.name',
        order: !byLatestRun && sort.direction === 'descending' ? 'desc' : 'asc',
      },
      fullTextFilter: name
        ? { term: name, fields: ['metadata.name', 'metadata.title'] }
        : undefined,
      fields: ENTITY_FIELDS,
    });
  }, [
    catalogApi,
    groups.loading,
    filterKey,
    byLatestRun,
    sort.direction,
    cursor,
  ]);

  const loaded = useMemo(() => entities.value?.items ?? [], [entities.value]);
  const totalItems = entities.value?.totalItems ?? 0;
  const latestRunSortable = totalItems <= MAX_ROWS_SORTED_BY_LATEST_RUN;
  // Filters that bring more rows than can be sorted by the latest run go
  // back to the name order, or the rows past the limit would be missing.
  const tooManyToSort =
    byLatestRun && Boolean(entities.value) && !latestRunSortable;
  useEffect(() => {
    if (tooManyToSort) setSort({ column: 'name', direction: 'ascending' });
  }, [tooManyToSort]);

  const [numbers, setNumbers] = useState<Record<string, RowNumbers>>({});
  const refsToRead = useMemo(
    () => loaded.map(e => stringifyEntityRef(e)),
    [loaded],
  );

  /** The error of the last request of numbers that failed as a whole. */
  const [requestError, setRequestError] = useState<Error>();
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
          if (mounted.current) setRequestError(undefined);
        } catch (error) {
          if (mounted.current) {
            setRequestError(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          const message =
            error instanceof Error ? error.message : String(error);
          const updatedAt = new Date().toISOString();
          result = Object.fromEntries(
            batch.map(ref => [
              ref,
              {
                entityRef: ref,
                running: 0,
                completed: 0,
                failed: 0,
                windowDays: 7,
                sampleSize: 0,
                updatedAt,
                error: { message },
              },
            ]),
          );
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
      return (
        n === undefined ||
        (typeof n === 'object' && Date.parse(n.updatedAt) < stale)
      );
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
  const allRead = readable.every(e => {
    const n = numbers[stringifyEntityRef(e)];
    return n !== undefined && n !== 'loading';
  });
  let rows = readable;
  if (byLatestRun) {
    const startOf = (e: Entity) => {
      const n = numbers[stringifyEntityRef(e)];
      const time =
        typeof n === 'object' && n.latestRun?.startTime
          ? Date.parse(n.latestRun.startTime)
          : NaN;
      return Number.isFinite(time) ? time : undefined;
    };
    const sign = sort.direction === 'ascending' ? 1 : -1;
    rows = [...readable].sort((a, b) => {
      const ta = startOf(a);
      const tb = startOf(b);
      if (ta === undefined || tb === undefined) {
        // Rows without a run go last either way.
        return (ta === undefined ? 1 : 0) - (tb === undefined ? 1 : 0);
      }
      return (ta - tb) * sign;
    });
    rows = rows.slice(
      localPage * WORKFLOW_TYPES_PAGE_SIZE,
      (localPage + 1) * WORKFLOW_TYPES_PAGE_SIZE,
    );
  }

  const shown = rows
    .map(e => numbers[stringifyEntityRef(e)])
    .filter((n): n is WorkflowTypeOverview => typeof n === 'object');
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

  const numbersCell = (
    numbersOf: RowNumbers | undefined,
    render: (o: WorkflowTypeOverview) => ReactNode,
    width = 80,
  ) => {
    if (numbersOf === undefined || numbersOf === 'loading') {
      return <Skeleton width={width} height={12} />;
    }
    if (numbersOf === 'missing') return null;
    if (numbersOf.error) return null;
    return render(numbersOf);
  };

  const columnDefs: ColumnDef[] = [
    {
      id: 'name',
      title: 'Workflow',
      sortable: true,
      cell: entity => (
        <Flex direction="column" gap="0">
          <Inner>
            <EntityRefLink entityRef={entity}>
              {entity.metadata.title ?? entity.metadata.name}
            </EntityRefLink>
          </Inner>
          {entity.metadata.description && (
            <Text variant="body-x-small" color="secondary">
              {entity.metadata.description}
            </Text>
          )}
        </Flex>
      ),
    },
    {
      id: 'owner',
      title: 'Owner',
      cell: entity => {
        const owners = getEntityRelations(entity, RELATION_OWNED_BY);
        return owners.length > 0 ? (
          <Inner>
            <EntityRefLinks entityRefs={owners} defaultKind="group" />
          </Inner>
        ) : null;
      },
    },
    {
      id: 'system',
      title: 'System',
      cell: entity => {
        const systems = getEntityRelations(entity, RELATION_PART_OF, {
          kind: 'system',
        });
        return systems.length > 0 ? (
          <Inner>
            <EntityRefLinks entityRefs={systems} defaultKind="system" />
          </Inner>
        ) : null;
      },
    },
    {
      id: 'counts',
      title: 'Running / Completed / Failed',
      help: COUNTS_HELP,
      cell: (entity, n) => {
        const ref = stringifyEntityRef(entity);
        if (typeof n === 'object' && n.error) {
          return (
            <Flex align="center" gap="1">
              <span title={n.error.message} data-testid="overview-error">
                —
              </span>
              <Inner>
                <ButtonIcon
                  size="small"
                  variant="tertiary"
                  icon={<RiRefreshLine aria-hidden />}
                  aria-label={`Retry ${entity.metadata.name}`}
                  onPress={() => retry(ref)}
                />
              </Inner>
            </Flex>
          );
        }
        return numbersCell(n, o => <Counts overview={o} />);
      },
    },
    {
      id: 'latestRun',
      title: 'Latest run',
      help: latestRunSortable ? undefined : LATEST_RUN_SORT_HELP,
      sortable: latestRunSortable,
      cell: (_entity, n) =>
        numbersCell(n, o =>
          o.latestRun ? (
            <Flex align="center" gap="2" style={{ whiteSpace: 'nowrap' }}>
              <WorkflowStatusLabel status={o.latestRun.status} />
              <RunLink run={o.latestRun} />
            </Flex>
          ) : (
            <Text variant="body-small" color="secondary">
              No runs
            </Text>
          ),
        ),
    },
    {
      id: 'duration',
      title: 'Average (last 50)',
      help: 'Mean duration of the closed runs among the 50 most recent runs.',
      cell: (_entity, n) =>
        numbersCell(n, o => (
          <Text variant="body-small">
            {o.averageDurationMs !== undefined
              ? formatMilliseconds(o.averageDurationMs)
              : ''}
          </Text>
        )),
    },
    {
      id: 'lastFailure',
      title: 'Last failure (7 days)',
      cell: (_entity, n) =>
        numbersCell(n, o =>
          o.lastFailure ? (
            <RunLink run={o.lastFailure} time={o.lastFailure.closeTime} />
          ) : null,
        ),
    },
  ];
  for (const optional of OPTIONAL_COLUMNS) {
    if (!columns.has(optional.id)) continue;
    columnDefs.push({
      id: optional.id,
      title: optional.title,
      cell: entity => {
        const spec = (entity.spec ?? {}) as Record<string, unknown>;
        switch (optional.id) {
          case 'lifecycle':
            return (
              <Text variant="body-small">{String(spec.lifecycle ?? '')}</Text>
            );
          case 'source':
            return (
              <Text variant="body-small">
                {String(spec.namespace ?? defaultNamespace)}
                {spec.taskQueue ? ` / ${String(spec.taskQueue)}` : ''}
              </Text>
            );
          case 'usedBy': {
            const usedBy = getEntityRelations(entity, RELATION_DEPENDENCY_OF);
            return usedBy.length > 0 ? (
              <Inner>
                <EntityRefLinks entityRefs={usedBy} />
              </Inner>
            ) : null;
          }
          default:
            return (
              <Text variant="body-small">
                {(entity.metadata.tags ?? []).join(', ')}
              </Text>
            );
        }
      },
    });
  }

  const facetOptions = (facet: string, filter?: (value: string) => boolean) =>
    (facets.value?.facets[facet] ?? [])
      .map(f => f.value)
      .filter(value => !filter || filter(value));
  const ownerOptions = [
    ...(myGroups.length > 0 ? [{ id: MINE, label: 'My teams' }] : []),
    { id: ALL, label: 'All' },
    ...facetOptions('relations.ownedBy').map(ref => ({
      id: ref,
      label: refLabel(ref, 'group'),
    })),
  ];
  const systemOptions = [
    { id: ANY, label: 'All' },
    ...facetOptions('relations.partOf', ref =>
      ref.toLocaleLowerCase('en-US').startsWith('system:'),
    ).map(ref => ({ id: ref, label: refLabel(ref, 'system') })),
  ];
  const lifecycleOptions = [
    { id: ANY, label: 'All' },
    ...facetOptions('spec.lifecycle').map(value => ({
      id: value,
      label: value,
    })),
  ];

  const filterBar = (
    <Flex align="end" gap="2" mb="3" style={{ flexWrap: 'wrap' }}>
      <SearchField
        label="Name"
        size="small"
        value={draftName}
        onChange={setDraftName}
        onSubmit={value => setParam('q', value.trim() || undefined)}
        onClear={() => setParam('q', undefined)}
        style={{ minWidth: 200 }}
      />
      <Select
        label="Owner"
        size="small"
        style={{ minWidth: 180 }}
        options={ownerOptions}
        selectedKey={owner}
        onSelectionChange={key =>
          setParam(
            'owner',
            !key || (String(key) === MINE && myGroups.length > 0)
              ? undefined
              : String(key),
          )
        }
      />
      <Select
        label="System"
        size="small"
        style={{ minWidth: 160 }}
        options={systemOptions}
        selectedKey={system || ANY}
        onSelectionChange={key =>
          setParam('system', !key || key === ANY ? undefined : String(key))
        }
      />
      <Select
        label="Lifecycle"
        size="small"
        style={{ minWidth: 140 }}
        options={lifecycleOptions}
        selectedKey={lifecycle || ANY}
        onSelectionChange={key =>
          setParam('lifecycle', !key || key === ANY ? undefined : String(key))
        }
      />
      <div style={{ marginLeft: 'auto' }}>
        <MenuTrigger>
          <Button variant="secondary" size="small">
            Columns
          </Button>
          <Menu
            aria-label="Optional columns"
            selectionMode="multiple"
            selectedKeys={columns}
            onSelectionChange={keys =>
              setColumns(
                keys === 'all'
                  ? new Set(OPTIONAL_COLUMNS.map(c => c.id))
                  : new Set([...keys] as Optional[]),
              )
            }
          >
            {OPTIONAL_COLUMNS.map(c => (
              <MenuItem key={c.id} id={c.id}>
                {c.title}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      </div>
    </Flex>
  );

  const pageCount = Math.max(
    1,
    Math.ceil(readable.length / WORKFLOW_TYPES_PAGE_SIZE),
  );
  const pending =
    groups.loading || entities.loading || (byLatestRun && !allRead);

  return (
    <PanelCard
      title="Workflows"
      subtitle="The TemporalWorkflow entities you can see, with the numbers of their runs."
      actions={
        oldest !== undefined && (
          <Text
            variant="body-small"
            color="secondary"
            data-testid="overview-updated"
          >
            Updated {agoText(Math.max(0, Math.round((now - oldest) / 1000)))}
          </Text>
        )
      }
    >
      {filterBar}
      {rateLimited && (
        <div style={{ marginBottom: 12 }}>
          <Alert
            status="warning"
            icon
            title="Temporal is rate limiting the backend"
            description="Some numbers could not be read. Retry them in a moment."
            data-testid="overview-rate-limited"
          />
        </div>
      )}
      <Text
        as="p"
        variant="body-x-small"
        color="secondary"
        style={{ margin: '0 0 8px' }}
      >
        {COUNTS_HELP}
      </Text>
      {requestError && !entities.error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorAlert
            error={requestError}
            title="The numbers of the workflows could not be read"
          />
        </div>
      )}
      {entities.error ? (
        <ErrorAlert error={entities.error} />
      ) : (
        <TableRoot
          aria-label="Workflows"
          isPending={pending}
          sortDescriptor={sort}
          onSortChange={descriptor =>
            setSort({
              column: descriptor.column as SortColumn,
              direction: descriptor.direction,
            })
          }
        >
          <TableHeader columns={columnDefs}>
            {column => (
              <Column
                id={column.id}
                isRowHeader={column.id === 'name'}
                allowsSorting={column.sortable}
              >
                <span title={column.help}>{column.title}</span>
              </Column>
            )}
          </TableHeader>
          <TableBody
            items={(byLatestRun && !allRead ? [] : rows).map(entity => ({
              id: stringifyEntityRef(entity),
              entity,
            }))}
            renderEmptyState={() =>
              pending ? null : (
                <Text as="p" variant="body-medium" color="secondary">
                  No TemporalWorkflow entities match these filters.
                </Text>
              )
            }
          >
            {item => (
              <Row
                id={item.id}
                columns={columnDefs}
                onAction={() =>
                  navigate(entityRoute(entityRouteParams(item.entity)))
                }
              >
                {column => (
                  <Cell>{column.cell(item.entity, numbers[item.id])}</Cell>
                )}
              </Row>
            )}
          </TableBody>
        </TableRoot>
      )}
      {byLatestRun ? (
        <Pager
          page={localPage + 1}
          hasPrevious={localPage > 0}
          hasNext={localPage + 1 < pageCount}
          disabled={pending}
          onPrevious={() => setLocalPage(p => Math.max(0, p - 1))}
          onNext={() => setLocalPage(p => p + 1)}
        />
      ) : (
        <Pager
          page={cursors.length}
          hasPrevious={cursors.length > 1}
          hasNext={Boolean(entities.value?.pageInfo.nextCursor)}
          disabled={pending}
          onPrevious={() => setCursors(c => c.slice(0, -1))}
          onNext={() => {
            const next = entities.value?.pageInfo.nextCursor;
            if (next) setCursors(c => [...c, next]);
          }}
        />
      )}
    </PanelCard>
  );
}
