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

import { Grid } from '@material-ui/core';
import {
  EntityAboutCard,
  EntityHasSubcomponentsCard,
  EntityLayout,
  EntityLinksCard,
  EntitySwitch,
  EntityOrphanWarning,
  EntityProcessingErrorsPanel,
  isKind,
  hasCatalogProcessingErrors,
  isOrphan,
} from '@backstage/plugin-catalog';
import {
  EntityUserProfileCard,
  EntityGroupProfileCard,
  EntityMembersListCard,
  EntityOwnershipCard,
} from '@backstage/plugin-org';
import {
  EntityTemporalContent,
  EntityTemporalRelatedWorkflowsCard,
  EntityTemporalWorkflowSummaryCard,
  isTemporalAvailable,
  getDependsOnTemporalWorkflowRefs,
  isTemporalWorkflowEntity,
  createTemporalControlActionDef,
  TemporalWorkflowActionDef,
} from '@kwkevinchan/backstage-plugin-temporal';
import { EntityTemporalDefinitionContent } from '@kwkevinchan/backstage-plugin-temporal-module-zigflow';
import { CopyWorkflowIdAction } from '../temporal/CopyWorkflowIdAction';

export const temporalWorkflowActions: TemporalWorkflowActionDef[] = [
  { id: 'copy-workflow-id', component: CopyWorkflowIdAction },
  // Runs the example backend action (packages/backend/src/escalateAction.ts).
  createTemporalControlActionDef({
    actionId: 'escalate',
    label: 'Escalate',
    confirm: 'Raise the priority of this ticket to high?',
    filter: workflow =>
      workflow.workflowType === 'ticketWorkflow' &&
      workflow.status === 'Running',
  }),
];

const entityWarningContent = (
  <>
    <EntitySwitch>
      <EntitySwitch.Case if={isOrphan}>
        <Grid item xs={12}>
          <EntityOrphanWarning />
        </Grid>
      </EntitySwitch.Case>
    </EntitySwitch>
    <EntitySwitch>
      <EntitySwitch.Case if={hasCatalogProcessingErrors}>
        <Grid item xs={12}>
          <EntityProcessingErrorsPanel />
        </Grid>
      </EntitySwitch.Case>
    </EntitySwitch>
  </>
);

const overviewContent = (
  <Grid container spacing={3} alignItems="stretch">
    {entityWarningContent}
    <Grid item md={6} xs={12}>
      <EntityAboutCard />
    </Grid>
    <Grid item md={6} xs={12}>
      <EntityLinksCard />
    </Grid>
    <EntitySwitch>
      <EntitySwitch.Case
        if={e => getDependsOnTemporalWorkflowRefs(e).length > 0}
      >
        <Grid item md={12} xs={12}>
          <EntityTemporalRelatedWorkflowsCard />
        </Grid>
      </EntitySwitch.Case>
    </EntitySwitch>
    <Grid item md={12} xs={12}>
      <EntityHasSubcomponentsCard />
    </Grid>
  </Grid>
);

// The Temporal tab works for any kind that carries the annotations.
const temporalRoute = (
  <EntityLayout.Route
    path="/temporal"
    title="Temporal"
    if={isTemporalAvailable}
  >
    <EntityTemporalContent workflowActions={temporalWorkflowActions} />
  </EntityLayout.Route>
);

const componentPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      {overviewContent}
    </EntityLayout.Route>
    {temporalRoute}
  </EntityLayout>
);

// TemporalWorkflow entities: overview with the workflow summary, the
// Temporal tab with recent run statistics and the runs, and the Definition
// tab of @kwkevinchan/backstage-plugin-temporal-module-zigflow (the YAML and its
// graph, or links to the code).
const temporalWorkflowPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      <Grid container spacing={3} alignItems="stretch">
        {entityWarningContent}
        <Grid item md={6} xs={12}>
          <EntityAboutCard />
        </Grid>
        <Grid item md={6} xs={12}>
          <EntityTemporalWorkflowSummaryCard />
        </Grid>
      </Grid>
    </EntityLayout.Route>
    {temporalRoute}
    <EntityLayout.Route path="/definition" title="Definition">
      <EntityTemporalDefinitionContent />
    </EntityLayout.Route>
  </EntityLayout>
);

const userPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      <Grid container spacing={3}>
        {entityWarningContent}
        <Grid item xs={12} md={6}>
          <EntityUserProfileCard />
        </Grid>
        <Grid item xs={12} md={6}>
          <EntityOwnershipCard />
        </Grid>
      </Grid>
    </EntityLayout.Route>
  </EntityLayout>
);

const groupPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      <Grid container spacing={3}>
        {entityWarningContent}
        <Grid item xs={12} md={6}>
          <EntityGroupProfileCard />
        </Grid>
        <Grid item xs={12} md={6}>
          <EntityOwnershipCard />
        </Grid>
        <Grid item xs={12}>
          <EntityMembersListCard />
        </Grid>
      </Grid>
    </EntityLayout.Route>
  </EntityLayout>
);

const defaultEntityPage = (
  <EntityLayout>
    <EntityLayout.Route path="/" title="Overview">
      {overviewContent}
    </EntityLayout.Route>
    {temporalRoute}
  </EntityLayout>
);

export const entityPage = (
  <EntitySwitch>
    <EntitySwitch.Case if={isKind('component')} children={componentPage} />
    <EntitySwitch.Case
      if={isTemporalWorkflowEntity}
      children={temporalWorkflowPage}
    />
    <EntitySwitch.Case if={isKind('group')} children={groupPage} />
    <EntitySwitch.Case if={isKind('user')} children={userPage} />
    <EntitySwitch.Case>{defaultEntityPage}</EntitySwitch.Case>
  </EntitySwitch>
);
