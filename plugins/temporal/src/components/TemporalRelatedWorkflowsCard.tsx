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

import { RELATION_DEPENDS_ON } from '@backstage/catalog-model';
import {
  EntityRefLink,
  EntityRefLinks,
  getEntityRelations,
  useEntity,
  useRelatedEntities,
} from '@backstage/plugin-catalog-react';
import { TEMPORAL_WORKFLOW_KIND } from '../common';
import {
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableRoot,
  Text,
} from '@backstage/ui';
import { ErrorAlert, Loading } from './feedback';
import { PanelCard } from './PanelCard';

/** The `TemporalWorkflow` entities that the current entity depends on. */
export function TemporalRelatedWorkflowsCard() {
  const { entity } = useEntity();
  const { entities, loading, error } = useRelatedEntities(entity, {
    type: RELATION_DEPENDS_ON,
    kind: TEMPORAL_WORKFLOW_KIND,
  });

  let body;
  if (loading) {
    body = <Loading />;
  } else if (error) {
    body = <ErrorAlert error={error} />;
  } else if (!entities || entities.length === 0) {
    body = (
      <Text as="p" variant="body-medium">
        This entity does not depend on any TemporalWorkflow entity.
      </Text>
    );
  } else {
    body = (
      <TableRoot aria-label="Workflow entities">
        <TableHeader>
          <Column isRowHeader>Workflow</Column>
          <Column>Workflow type</Column>
          <Column>Task queue</Column>
          <Column>Owner</Column>
        </TableHeader>
        <TableBody>
          {entities.map(workflow => {
            const spec = (workflow.spec ?? {}) as {
              workflowType?: string;
              taskQueue?: string;
            };
            return (
              <Row
                key={workflow.metadata.uid ?? workflow.metadata.name}
                id={workflow.metadata.uid ?? workflow.metadata.name}
              >
                <Cell>
                  <EntityRefLink entityRef={workflow} />
                </Cell>
                <Cell>
                  <Text variant="body-small">{spec.workflowType}</Text>
                </Cell>
                <Cell>
                  <Text variant="body-small">{spec.taskQueue}</Text>
                </Cell>
                <Cell>
                  <EntityRefLinks
                    entityRefs={getEntityRelations(workflow, 'ownedBy')}
                    defaultKind="group"
                  />
                </Cell>
              </Row>
            );
          })}
        </TableBody>
      </TableRoot>
    );
  }

  return (
    <PanelCard
      title="Workflow entities"
      subtitle="TemporalWorkflow entities in spec.dependsOn; their runs are listed below."
    >
      {body}
    </PanelCard>
  );
}
