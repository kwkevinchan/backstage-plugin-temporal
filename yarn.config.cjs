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

// @ts-check
/** @type {import('@yarnpkg/types')} */
const { defineConfig } = require('@yarnpkg/types');

const REPO_URL = 'https://github.com/kwkevinchan/backstage-plugin-temporal';
const SCOPE = '@kwkevinchan/';
const NPMJS = 'https://registry.npmjs.org/';
/**
 * Library for Temporal workers: `/loop` (loop marks) and `/llm` (LLM steps),
 * both running in the workflow sandbox. It has no runtime dependencies; the
 * Temporal workflow SDK is an optional peer dependency.
 */
const WORKFLOW_KIT = '@kwkevinchan/temporal-workflow-kit';
const WORKFLOW_KIT_PEERS = new Set(['@temporalio/workflow']);

const BACKEND_ROLES = new Set([
  'backend',
  'backend-plugin',
  'backend-plugin-module',
  'node-library',
]);
const FRONTEND_ROLES = new Set([
  'frontend',
  'frontend-plugin',
  'frontend-plugin-module',
  'web-library',
]);

/** Packages that only make sense on the Node side. */
const isNodeOnlyDep = name =>
  /^@backstage\/backend-/.test(name) ||
  /^@backstage\/plugin-[a-z-]+-node$/.test(name) ||
  /^@temporalio\//.test(name);

/** Packages that only make sense in the browser. */
const isWebOnlyDep = name =>
  /^@backstage\/(core-|frontend-|app-|ui$)/.test(name) ||
  /^@backstage\/plugin-[a-z-]+-react$/.test(name) ||
  /^(react|react-dom|react-router|react-router-dom)$/.test(name) ||
  /^@material-ui\//.test(name) ||
  /^@mui\//.test(name);

const roleOf = workspace => workspace.manifest.backstage?.role;

/**
 * The plugin ships one backend and one frontend package; every other
 * published package is a module that builds on the core of its side.
 */
const BACKEND_CORE = '@kwkevinchan/backstage-plugin-temporal-backend';
const FRONTEND_CORE = '@kwkevinchan/backstage-plugin-temporal-frontend';

module.exports = defineConfig({
  async constraints({ Yarn }) {
    const byIdent = new Map(Yarn.workspaces().map(w => [w.ident, w]));

    // Published packages of one plugin list each other in
    // backstage.pluginPackages (used by the Backstage CLI and tooling).
    // Modules are left out, those of this plugin (Zigflow) and those of
    // other plugins (Scaffolder).
    const isModule = workspace => /-module$/.test(roleOf(workspace) ?? '');
    const packagesByPluginId = new Map();
    for (const workspace of Yarn.workspaces()) {
      const pluginId = workspace.manifest.backstage?.pluginId;
      if (!pluginId || workspace.manifest.private === true) continue;
      if (isModule(workspace)) continue;
      const list = packagesByPluginId.get(pluginId) ?? [];
      list.push(workspace.ident);
      packagesByPluginId.set(pluginId, list);
    }
    for (const workspace of Yarn.workspaces()) {
      const pluginId = workspace.manifest.backstage?.pluginId;
      if (!pluginId || workspace.manifest.private === true) continue;
      if (isModule(workspace)) continue;
      workspace.set(
        'backstage.pluginPackages',
        [...packagesByPluginId.get(pluginId)].sort(),
      );
    }

    for (const workspace of Yarn.workspaces()) {
      const isPrivate = workspace.manifest.private === true;
      const isRoot = workspace.cwd === '.';

      // Every workspace is Apache-2.0.
      workspace.set('license', 'Apache-2.0');

      if (isRoot || isPrivate) continue;

      // Published packages: npmjs only, under our scope, pointing at this repo.
      if (!workspace.ident?.startsWith(SCOPE)) {
        workspace.error(`Published packages must use the ${SCOPE} scope`);
      }
      workspace.set('repository.type', 'git');
      workspace.set('repository.url', REPO_URL);
      workspace.set('repository.directory', workspace.cwd);
      const registry = workspace.manifest.publishConfig?.registry;
      if (registry !== undefined && registry !== NPMJS) {
        workspace.error(`publishConfig.registry must be ${NPMJS} or unset`);
      }
    }

    for (const dep of Yarn.dependencies()) {
      const workspace = dep.workspace;
      const isPublished =
        workspace.manifest.private !== true && workspace.cwd !== '.';
      const target = byIdent.get(dep.ident);

      // Packages from our scope must come from this workspace (no private packages).
      if (dep.ident.startsWith(SCOPE) && !target) {
        dep.error(
          `${dep.ident} is not part of this repository; depending on packages outside it is not allowed`,
        );
      }

      // Published packages: no private workspaces; the two core packages
      // depend on no other workspace; a module only on the core of its side.
      if (isPublished && target && dep.type !== 'devDependencies') {
        const isCore =
          workspace.ident === BACKEND_CORE || workspace.ident === FRONTEND_CORE;
        if (target.manifest.private === true) {
          dep.error(
            `Published packages must not depend on the private package ${dep.ident}`,
          );
        } else if (isCore) {
          dep.error(
            `${workspace.ident} must not depend on other packages of this repository (${dep.ident})`,
          );
        } else {
          const core = BACKEND_ROLES.has(roleOf(workspace))
            ? BACKEND_CORE
            : FRONTEND_CORE;
          if (dep.ident !== core) {
            dep.error(
              `${workspace.ident} may only depend on ${core} of this repository, not ${dep.ident}`,
            );
          }
        }
      }

      // Published packages must not use local or git protocols.
      if (
        isPublished &&
        /^(link|portal|file|git|github|https?):/.test(dep.range)
      ) {
        dep.error(`Published packages must not use ${dep.range}`);
      }
      // Never resolve anything from GitHub Packages.
      if (/npm\.pkg\.github\.com/.test(dep.range)) {
        dep.error('Dependencies must not come from GitHub Packages');
      }

      const role = roleOf(workspace);
      const targetRole = target ? roleOf(target) : undefined;

      // Frontend packages: no Node-side workspaces or Node-only packages.
      if (
        FRONTEND_ROLES.has(role) &&
        role !== 'frontend' &&
        dep.type !== 'devDependencies'
      ) {
        if (
          (targetRole && BACKEND_ROLES.has(targetRole)) ||
          isNodeOnlyDep(dep.ident)
        ) {
          dep.error(`frontend packages must not depend on ${dep.ident}`);
        }
      }

      // Backend packages: no frontend workspaces or browser-only packages.
      // (A backend may bundle the app it serves.)
      const servesApp = role === 'backend' && targetRole === 'frontend';
      if (
        BACKEND_ROLES.has(role) &&
        dep.type !== 'devDependencies' &&
        !servesApp
      ) {
        if (
          (targetRole && FRONTEND_ROLES.has(targetRole)) ||
          isWebOnlyDep(dep.ident)
        ) {
          dep.error(`backend packages must not depend on ${dep.ident}`);
        }
      }

      // The workflow kit: only optional peer dependencies at run time.
      if (workspace.ident === WORKFLOW_KIT && dep.type !== 'devDependencies') {
        if (
          dep.type !== 'peerDependencies' ||
          !WORKFLOW_KIT_PEERS.has(dep.ident)
        ) {
          dep.error(
            `${WORKFLOW_KIT} may only have ${[...WORKFLOW_KIT_PEERS].join(
              ', ',
            )} as (optional) peer dependencies, not ${dep.ident} in ${
              dep.type
            }`,
          );
        } else {
          workspace.set(['peerDependenciesMeta', dep.ident, 'optional'], true);
        }
      }

      // Published packages talk to Temporal through the client only; the
      // worker and workflow packages (native code, sandbox) stay out.
      // The one exception is the workflow kit, whose `/loop` runs inside
      // workflow code: it uses @temporalio/workflow as a peer dependency, so
      // the workflow's own SDK version is used and nothing is bundled twice.
      const isWorkflowHelperPeer =
        workspace.ident === WORKFLOW_KIT &&
        dep.type === 'peerDependencies' &&
        dep.ident === '@temporalio/workflow';
      if (
        isPublished &&
        dep.type !== 'devDependencies' &&
        /^@temporalio\//.test(dep.ident) &&
        dep.ident !== '@temporalio/client' &&
        !isWorkflowHelperPeer
      ) {
        dep.error(
          `Published packages may only use @temporalio/client, not ${dep.ident}`,
        );
      }

      // Workspace dependencies use the workspace protocol.
      if (
        target &&
        dep.type !== 'peerDependencies' &&
        !dep.range.startsWith('workspace:')
      ) {
        dep.update('workspace:^');
      }
    }

    // One range for each external runtime dependency across published packages.
    const ranges = new Map();
    for (const dep of Yarn.dependencies({ type: 'dependencies' })) {
      if (byIdent.has(dep.ident)) continue;
      if (dep.workspace.manifest.private === true || dep.workspace.cwd === '.')
        continue;
      const seen = ranges.get(dep.ident);
      if (seen === undefined) ranges.set(dep.ident, dep.range);
      else if (seen !== dep.range) {
        dep.error(`${dep.ident} uses ${dep.range} here but ${seen} elsewhere`);
      }
    }
  },
});
