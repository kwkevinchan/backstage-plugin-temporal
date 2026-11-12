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

import { screen } from '@testing-library/react';
import { configApiRef } from '@backstage/core-plugin-api';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { temporalApiRef } from '../extensions';
import { LegacyEntityTemporalContentPage } from '../components/EntityTemporalContent';
import { entity, mockTemporalApi } from '../testData';
import { TemporalControlApi, temporalControlApiRef } from './api';

/*
 * The entity tab of the legacy frontend system brings the operations that
 * change workflows without any props, and leaves them out when
 * `temporal.control.enabled` is false.
 */
async function renderDetails(control: object) {
  const api = mockTemporalApi();
  await renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [temporalControlApiRef, {} as TemporalControlApi],
        [permissionApiRef, mockApis.permission()],
        [configApiRef, mockApis.config({ data: { temporal: { control } } })],
      ]}
    >
      <EntityProvider entity={entity}>
        <LegacyEntityTemporalContentPage />
      </EntityProvider>
    </TestApiProvider>,
    { routeEntries: ['/namespaces/default/workflows/payment-1/runs/run-2'] },
  );
  // The run is loaded once its summary shows.
  expect(await screen.findByTestId('workflow-summary')).toHaveTextContent(
    'Failed',
  );
}

describe('legacy entity tab', () => {
  it('shows Rerun on a closed run without any props', async () => {
    await renderDetails({});
    expect(
      await screen.findByRole('button', { name: 'Rerun' }),
    ).toBeInTheDocument();
  });

  it('shows no operations when temporal.control.enabled is false', async () => {
    await renderDetails({ enabled: false });
    expect(screen.queryByRole('button', { name: 'Rerun' })).toBeNull();
  });
});
