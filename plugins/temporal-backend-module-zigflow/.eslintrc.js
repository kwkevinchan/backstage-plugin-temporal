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

// The Zigflow module is a module of the Temporal backend plugin: it reads
// the permission and the spec of the TemporalWorkflow kind from that plugin.
// Backstage warns about a module importing a backend plugin; this one is
// allowed (as for the catalog module).
module.exports = require('@backstage/cli/config/eslint-factory')(__dirname, {
  rules: {
    '@backstage/no-mixed-plugin-imports': [
      'warn',
      {
        excludedTargetPackages: [
          '@kwkevinchan/backstage-plugin-temporal-backend',
        ],
      },
    ],
  },
});
