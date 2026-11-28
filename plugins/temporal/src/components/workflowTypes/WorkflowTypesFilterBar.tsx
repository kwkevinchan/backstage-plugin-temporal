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

import { parseEntityRef } from '@backstage/catalog-model';
import { humanizeEntityRef } from '@backstage/plugin-catalog-react';
import {
  Button,
  Flex,
  Menu,
  MenuItem,
  MenuTrigger,
  SearchField,
  Select,
} from '@backstage/ui';
import { ALL, MINE, WorkflowTypeFilters } from './useWorkflowTypeEntities';
import { Optional, OPTIONAL_COLUMNS } from './workflowTypeColumns';

const ANY = 'any';

function refLabel(ref: string, defaultKind: string): string {
  try {
    return humanizeEntityRef(parseEntityRef(ref), { defaultKind });
  } catch {
    return ref;
  }
}

/**
 * The filters above the table of the Workflows tab, and the menu of its
 * optional columns.
 */
export function WorkflowTypesFilterBar(props: {
  filters: WorkflowTypeFilters;
  columns: Set<Optional>;
  onColumnsChange(columns: Set<Optional>): void;
}) {
  const { columns } = props;
  const {
    owner,
    system,
    lifecycle,
    myGroups,
    draftName,
    setDraftName,
    setParam,
    facets,
  } = props.filters;
  const facetOptions = (facet: string, filter?: (value: string) => boolean) =>
    (facets?.[facet] ?? [])
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

  return (
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
              props.onColumnsChange(
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
}
