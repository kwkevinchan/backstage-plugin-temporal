import { createDevApp } from '@backstage/dev-utils';
import { temporalPlugin, TemporalPage } from '../src/plugin';

createDevApp()
  .registerPlugin(temporalPlugin)
  .addPage({
    element: <TemporalPage />,
    title: 'Root Page',
    path: '/temporal',
  })
  .render();
