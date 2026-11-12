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

/*
 * Backend modules import `./node`, `./alpha` and `./common`. Those entry
 * points must not load the plugin itself (its routes and their
 * dependencies): each of these modules throws when it is loaded.
 */
jest.mock('./plugin', () => {
  throw new Error('loaded src/plugin.ts');
});
jest.mock('./routes/router', () => {
  throw new Error('loaded src/routes/router.ts');
});
jest.mock('./routes/controlRoutes', () => {
  throw new Error('loaded src/routes/controlRoutes.ts');
});
jest.mock('./routes/download', () => {
  throw new Error('loaded src/routes/download.ts');
});

describe('entry points for backend modules', () => {
  it('./node loads without the plugin', () => {
    jest.isolateModules(() => {
      const node = require('./node');
      expect(node.temporalServiceRef.id).toBe('temporal.client');
      expect(node.temporalExtensionPoint.id).toBe(
        'temporal.workflow-enrichers',
      );
    });
  });

  it('./alpha loads without the plugin', () => {
    jest.isolateModules(() => {
      const alpha = require('./alpha');
      expect(alpha.temporalAccessServiceRef.id).toBe('temporal.access');
      expect(alpha.temporalControlExtensionPoint.id).toBe('temporal.control');
      expect(alpha.temporalWorkflowPermissionResourceRef.resourceType).toBe(
        'temporal-workflow',
      );
    });
  });

  it('./common loads without the plugin', () => {
    jest.isolateModules(() => {
      const common = require('./common');
      expect(common.temporalPermissions.length).toBeGreaterThan(0);
    });
  });

  it('the root entry point does load the plugin', () => {
    jest.isolateModules(() => {
      expect(() => require('./index')).toThrow(/loaded src\//);
    });
  });
});
