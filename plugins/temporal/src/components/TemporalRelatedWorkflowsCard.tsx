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
  InfoCard,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import {
  EntityRefLink,
  EntityRefLinks,
  getEntityRelations,
  useEntity,
  useRelatedEntities,
} from '@backstage/plugin-catalog-react';
import { TEMPORAL_WORKFLOW_KIND } from '@kwkevinchan/backstage-plugin-temporal-common';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Typography from '@material-ui/core/Typography';

/** The `TemporalWorkflow` entities that the current entity depends on. */
export function TemporalRelatedWorkflowsCard() {
  const { entity } = useEntity();
  const { entities, loading, error } = useRelatedEntities(entity, {
    type: RELATION_DEPENDS_ON,
    kind: TEMPORAL_WORKFLOW_KIND,
  });

  let body;
  if (loading) {
    body = <Progress />;
  } else if (error) {
    body = <ResponseErrorPanel error={error} />;
  } else if (!entities || entities.length === 0) {
    body = (
      <Typography variant="body2">
        This entity does not depend on any TemporalWorkflow entity.
      </Typography>
    );
  } else {
    body = (
      <Table size="small" aria-label="Workflow entities">
        <TableHead>
          <TableRow>
            <TableCell>Workflow</TableCell>
            <TableCell>Workflow type</TableCell>
            <TableCell>Task queue</TableCell>
            <TableCell>Owner</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entities.map(workflow => {
            const spec = (workflow.spec ?? {}) as {
              workflowType?: string;
              taskQueue?: string;
            };
            return (
              <TableRow key={workflow.metadata.uid ?? workflow.metadata.name}>
                <TableCell>
                  <EntityRefLink entityRef={workflow} />
                </TableCell>
                <TableCell>{spec.workflowType}</TableCell>
                <TableCell>{spec.taskQueue}</TableCell>
                <TableCell>
                  <EntityRefLinks
                    entityRefs={getEntityRelations(workflow, 'ownedBy')}
                    defaultKind="group"
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <InfoCard
      title="Workflow entities"
      subheader="TemporalWorkflow entities in spec.dependsOn; their runs are listed below."
    >
      {body}
    </InfoCard>
  );
}
