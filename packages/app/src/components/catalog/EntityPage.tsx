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
  isTemporalAvailable,
} from '@kwkevinchan/backstage-plugin-temporal';
import { TemporalWorkflowActionDef } from '@kwkevinchan/backstage-plugin-temporal-react';
import { CopyWorkflowIdAction } from '../temporal/CopyWorkflowIdAction';

const temporalWorkflowActions: TemporalWorkflowActionDef[] = [
  { id: 'copy-workflow-id', component: CopyWorkflowIdAction },
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
    <EntitySwitch.Case if={isKind('group')} children={groupPage} />
    <EntitySwitch.Case if={isKind('user')} children={userPage} />
    <EntitySwitch.Case>{defaultEntityPage}</EntitySwitch.Case>
  </EntitySwitch>
);
