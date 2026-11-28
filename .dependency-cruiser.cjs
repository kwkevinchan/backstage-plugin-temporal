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

// The layers of the published packages (see "Package layers" and "Backend
// layout" in CONTRIBUTING.md). Run with `yarn lint:deps`. Tests are not
// checked: they may reach into any layer, for example to compare a module's
// copy of a rule with the core's.

const BE = '^plugins/temporal-backend/src';
const FE = '^plugins/temporal/src';
const GRAPH = `${FE}/components/graph`;

/** Files of services/ that call Temporal without a repository. */
const CALLS_TEMPORAL = [
  'WorkflowCommands',
  'WorkflowListQueries',
  'concurrencyLimit',
];

/** Files of the frontend that hold logic without React. */
const PURE_FRONTEND = [
  `${FE}/components/timeline/timeline\\.ts$`,
  `${GRAPH}/edgeKind\\.ts$`,
  `${GRAPH}/eventGroups\\.ts$`,
  `${GRAPH}/layout\\.ts$`,
  `${GRAPH}/stackLayout\\.ts$`,
  `${GRAPH}/geometry\\.ts$`,
];

module.exports = {
  forbidden: [
    {
      name: 'backend-common-is-the-model',
      severity: 'error',
      comment:
        'src/common is copied to the frontend package and exported as ./common: it imports nothing else of the package, and of other packages only these three.',
      from: { path: `${BE}/common/` },
      to: {
        pathNot: [
          `${BE}/common/`,
          '^node_modules/@backstage/(catalog-model|plugin-permission-common|types)/',
        ],
      },
    },
    {
      name: 'services-do-not-import-repositories',
      severity: 'error',
      comment:
        'Use cases (services/) do not depend on the gateways (repositories/), apart from the read repository they are given (see services-are-given-the-read-repository).',
      from: {
        path: `${BE}/services/`,
        pathNot: `${BE}/services/(${CALLS_TEMPORAL.join('|')})\\.ts$`,
      },
      to: {
        path: `${BE}/repositories/`,
        pathNot: `${BE}/repositories/TemporalReadRepository\\.ts$`,
      },
    },
    {
      name: 'services-that-call-temporal',
      severity: 'error',
      comment:
        'Exception to services-do-not-import-repositories: the operations (WorkflowCommands) and the schedule list (WorkflowListQueries) call Temporal on the shared connection themselves, with the call helper, the error mapping and the schedule client of repositories/; concurrencyLimit uses the error messages. Nothing else of repositories/.',
      from: { path: `${BE}/services/(${CALLS_TEMPORAL.join('|')})\\.ts$` },
      to: {
        path: `${BE}/repositories/`,
        pathNot: `${BE}/repositories/(errors|scheduleClient|temporalCall|TemporalReadRepository)\\.ts$`,
      },
    },
    {
      name: 'services-are-given-the-read-repository',
      severity: 'error',
      comment:
        'The query classes are given the one TemporalReadRepository that the plugin (or the access service factory) creates; they import its type only, so that they cannot create a second one. It has no interface: the classes of the plugin are plain.',
      from: { path: `${BE}/services/` },
      to: {
        path: `${BE}/repositories/TemporalReadRepository\\.ts$`,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'gateways-do-not-import-use-cases',
      severity: 'error',
      comment:
        'Gateways (repositories/) and the payload formats they share with the use cases (lib/) do not depend on the use cases, the routes or the access checks.',
      from: { path: `${BE}/(repositories|lib)/` },
      to: { path: `${BE}/(services|routes|access)/` },
    },
    {
      name: 'services-do-not-import-express',
      severity: 'error',
      comment: 'HTTP belongs to routes/; the use cases do not know it.',
      from: { path: `${BE}/services/` },
      to: { path: '^node_modules/express/' },
    },
    {
      name: 'pure-frontend-files-without-react',
      severity: 'error',
      comment:
        'These files hold logic without React, so that it can be tested and reused outside a component: they reach no component file (.tsx) and no React package. They reach @xyflow/react only through graph/frameEdge.ts (see only-frame-edge-imports-react-flow).',
      from: { path: PURE_FRONTEND },
      to: {
        path: [
          '\\.tsx$',
          '^node_modules/(react|react-dom|@remixicon/react|@backstage/ui)/',
        ],
        reachable: true,
      },
    },
    {
      name: 'layout-without-react-flow',
      severity: 'error',
      comment:
        'The layout of the graph does not depend on the drawing library. Exception: layout.ts reaches @xyflow/react through frameEdge.ts, which routes the edges with the path function of React Flow (getSmoothStepPath) so that the layout leaves room for the lines that React Flow draws.',
      from: {
        path: [`${GRAPH}/stackLayout\\.ts$`, `${GRAPH}/geometry\\.ts$`],
      },
      to: { path: '^node_modules/@xyflow/react/', reachable: true },
    },
    {
      name: 'only-frame-edge-imports-react-flow',
      severity: 'error',
      comment:
        'Of the files without React, only graph/frameEdge.ts imports @xyflow/react (the exception of layout-without-react-flow).',
      from: {
        path: '^plugins/[^/]+/src/',
        pathNot: ['\\.tsx$', `${GRAPH}/frameEdge\\.ts$`],
      },
      to: { path: '^node_modules/@xyflow/react/' },
    },
    {
      name: 'modules-use-core-entry-points',
      severity: 'error',
      comment:
        'A module imports the core package of its side only through the entry points the core package exports.',
      from: {
        path: '^plugins/(?!temporal-(backend|frontend)/)[^/]+/src/',
      },
      to: {
        path: '^plugins/temporal-(backend|frontend)/src/',
        pathNot: [
          `${BE}/(index|alpha)\\.ts$`,
          `${BE}/(common|node)/index\\.ts$`,
          `${FE}/(index|ui)\\.ts$`,
          `${FE}/alpha\\.tsx$`,
          `${FE}/common/index\\.ts$`,
        ],
      },
    },
  ],
  options: {
    includeOnly: '^(plugins/[^/]+/src/|node_modules/)',
    exclude: {
      path: ['\\.test\\.tsx?$', '/__testUtils__/', '/setupTests\\.ts$'],
    },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts', '.json'],
      mainFields: ['types', 'typings', 'module', 'main'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
