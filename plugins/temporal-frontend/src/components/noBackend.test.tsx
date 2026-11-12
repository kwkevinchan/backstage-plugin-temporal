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
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { temporalApiRef } from '../extensions';
import { TemporalClient } from '../api';
import { entity } from '../testData';
import { EntityTemporalContentPage } from './EntityTemporalContent';
import { TemporalPageContent } from './TemporalPage';

/*
 * The frontend without the backend plugin: a backend that has no
 * `/api/temporal` (404 without a body) or no backend at all (the request
 * fails). The pages show the error instead of failing.
 */
const discoveryApi = { getBaseUrl: async () => 'http://backend/api/temporal' };
const missingPlugin = async () => new Response('', { status: 404 });
/** The plugin's own 404, with an error body. */
const notFound = async () =>
  new Response(
    JSON.stringify({
      error: { name: 'NotFoundError', message: 'No such entity' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );
const missingMessage =
  /does not serve the Temporal plugin: install @kwkevinchan\/backstage-plugin-temporal-backend/;
const unreachable = async () => {
  throw new TypeError('Failed to fetch');
};

function render(element: JSX.Element, fetch: () => Promise<Response>) {
  const api = new TemporalClient({ discoveryApi, fetchApi: { fetch } });
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [temporalApiRef, api],
        [permissionApiRef, mockApis.permission()],
      ]}
    >
      <EntityProvider entity={entity}>{element}</EntityProvider>
    </TestApiProvider>,
  );
}

describe('without the Temporal backend plugin', () => {
  it.each([
    ['no plugin', missingPlugin, missingMessage],
    ['unreachable', unreachable, /Failed to fetch/],
    ["the plugin's 404", notFound, /^Request failed with 404/],
  ])(
    'shows the error on the entity tab (%s)',
    async (_name, fetch, message) => {
      await render(<EntityTemporalContentPage />, fetch);
      const alerts = await screen.findAllByTestId('temporal-error');
      expect(alerts[0]).toHaveTextContent(message);
    },
  );

  it.each([
    ['no plugin', missingPlugin, missingMessage],
    ['unreachable', unreachable, /Failed to fetch/],
    ["the plugin's 404", notFound, /^Request failed with 404/],
  ])(
    'shows the error on the Workflows page (%s)',
    async (_name, fetch, message) => {
      await render(<TemporalPageContent />, fetch);
      const alerts = await screen.findAllByTestId('temporal-error');
      expect(alerts[0]).toHaveTextContent(message);
    },
  );
});
