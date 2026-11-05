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
  RELATION_DEPENDENCY_OF,
  RELATION_OWNED_BY,
  RELATION_PART_OF,
} from '@backstage/catalog-model';
import { Alert, ButtonLink } from '@backstage/ui';
import {
  EntityRefLinks,
  getEntityRelations,
  useEntity,
} from '@backstage/plugin-catalog-react';
import { isTemporalWorkflowEntity } from '../common';
import { RiExternalLinkLine } from '@remixicon/react';
import { PanelCard } from './PanelCard';
import { DefinitionList } from './StepDrawer';
import {
  useTemporalDefaultNamespace,
  useTemporalWebUiBaseUrl,
  workflowTypeWebUiUrl,
} from './webUi';

/** Overview of a `TemporalWorkflow` entity: what runs it and who owns it. */
export function TemporalWorkflowSummaryCard() {
  const { entity } = useEntity();
  const baseUrl = useTemporalWebUiBaseUrl();
  const defaultNamespace = useTemporalDefaultNamespace();
  if (!isTemporalWorkflowEntity(entity)) {
    return (
      <Alert
        status="warning"
        icon
        title="Not a TemporalWorkflow entity"
        description="This card only works on entities of kind TemporalWorkflow."
      />
    );
  }
  const spec = entity.spec ?? {};
  const namespace = spec.namespace ?? defaultNamespace;
  const owners = getEntityRelations(entity, RELATION_OWNED_BY);
  const systems = getEntityRelations(entity, RELATION_PART_OF, {
    kind: 'system',
  });
  const usedBy = getEntityRelations(entity, RELATION_DEPENDENCY_OF);
  const webUiUrl =
    baseUrl && spec.workflowType
      ? workflowTypeWebUiUrl(baseUrl, {
          namespace,
          workflowType: spec.workflowType,
          taskQueue: spec.taskQueue,
        })
      : undefined;
  const none = '—';

  return (
    <PanelCard
      title="Workflow type"
      subtitle="This entity is one Temporal Workflow Type and its Workflow Definition (the workflow code)."
      actions={
        webUiUrl && (
          <ButtonLink
            variant="secondary"
            size="small"
            href={webUiUrl}
            target="_blank"
            rel="noopener noreferrer"
            iconEnd={<RiExternalLinkLine />}
          >
            Open in Temporal UI
          </ButtonLink>
        )
      }
    >
      <DefinitionList
        items={[
          ['Workflow type', spec.workflowType ?? none],
          ['Task queue', spec.taskQueue ?? none],
          ['Namespace', namespace],
          [
            'Owner',
            owners.length > 0 ? (
              <EntityRefLinks entityRefs={owners} defaultKind="group" />
            ) : (
              spec.owner ?? none
            ),
          ],
          [
            'System',
            systems.length > 0 ? (
              <EntityRefLinks entityRefs={systems} defaultKind="system" />
            ) : (
              none
            ),
          ],
          ['Lifecycle', spec.lifecycle ?? none],
          [
            'Used by',
            usedBy.length > 0 ? <EntityRefLinks entityRefs={usedBy} /> : none,
          ],
        ]}
      />
    </PanelCard>
  );
}
