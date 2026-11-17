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
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { coreExtensionData } from '@backstage/frontend-plugin-api';
import { createExtensionTester } from '@backstage/frontend-test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import {
  mockApis,
  renderInTestApp,
  TestApiProvider,
} from '@backstage/test-utils';
import type { Entity } from '@backstage/catalog-model';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-frontend';
import zigflowModule, { temporalDefinitionContent } from './alpha';
import { EntityTemporalDefinitionContent } from './index';

const workflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'flow', namespace: 'default' },
  spec: { owner: 'team', workflowType: 'flow' },
};

const component: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders', namespace: 'default' },
  spec: { type: 'service', owner: 'team' },
};

const codeWorkflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: {
    name: 'order-workflow',
    namespace: 'default',
    annotations: {
      'backstage.io/view-url':
        'https://git.example.com/org/repo/blob/main/src/workflows.ts',
    },
  },
  spec: { owner: 'team', workflowType: 'orderWorkflow' },
};

describe('Zigflow module (new frontend system)', () => {
  it('adds the Definition tab to TemporalWorkflow entities only', () => {
    const tab = createExtensionTester(temporalDefinitionContent);
    expect(tab.get(coreExtensionData.routePath)).toBe('definition');
    expect(tab.get(EntityContentBlueprint.dataRefs.title)).toBe('Definition');
    const filter = tab.get(EntityContentBlueprint.dataRefs.filterFunction)!;
    expect(filter(workflowEntity)).toBe(true);
    expect(filter(component)).toBe(false);

    expect(zigflowModule.$$type).toBe('@backstage/FrontendModule');
    expect(zigflowModule.pluginId).toBe('temporal');
    const internal = zigflowModule as unknown as {
      extensions: Array<{ id: string }>;
    };
    expect(internal.extensions).toEqual([
      expect.objectContaining({ id: 'entity-content:temporal/definition' }),
    ]);
  });

  it('mounts the lazy alpha element and legacy EntityTemporalDefinitionContent extension', async () => {
    const api = {
      listEntityWorkflows: jest
        .fn()
        .mockResolvedValue({ namespace: 'default', items: [] }),
    };

    const element = createExtensionTester(temporalDefinitionContent).get(
      coreExtensionData.reactElement,
    );
    const alphaRender = await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api as any],
          [discoveryApiRef, { getBaseUrl: async () => '/api/temporal' }],
          [fetchApiRef, { fetch: jest.fn() }],
          [permissionApiRef, mockApis.permission()],
        ]}
      >
        <EntityProvider entity={codeWorkflowEntity}>{element}</EntityProvider>
      </TestApiProvider>,
    );
    expect(
      await screen.findByRole('link', { name: 'View the file' }),
    ).toHaveAttribute(
      'href',
      'https://git.example.com/org/repo/blob/main/src/workflows.ts',
    );
    alphaRender.unmount();

    const legacyRender = await renderInTestApp(
      <TestApiProvider
        apis={[
          [temporalApiRef, api as any],
          [discoveryApiRef, { getBaseUrl: async () => '/api/temporal' }],
          [fetchApiRef, { fetch: jest.fn() }],
          [permissionApiRef, mockApis.permission()],
        ]}
      >
        <EntityProvider entity={codeWorkflowEntity}>
          <EntityTemporalDefinitionContent />
        </EntityProvider>
      </TestApiProvider>,
    );
    expect(
      await screen.findByRole('link', { name: 'View the file' }),
    ).toBeInTheDocument();
    legacyRender.unmount();
  });
});
