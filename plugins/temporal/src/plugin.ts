import {
  createPlugin,
  createRoutableExtension,
} from '@backstage/core-plugin-api';

import { rootRouteRef } from './routes';

export const temporalPlugin = createPlugin({
  id: 'temporal',
  routes: {
    root: rootRouteRef,
  },
});

export const TemporalPage = temporalPlugin.provide(
  createRoutableExtension({
    name: 'TemporalPage',
    component: () =>
      import('./components/ExampleComponent').then(m => m.ExampleComponent),
    mountPoint: rootRouteRef,
  }),
);
