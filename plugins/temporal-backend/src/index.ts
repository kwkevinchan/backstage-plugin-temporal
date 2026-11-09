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

/**
 * Unofficial Backstage backend plugin for Temporal workflows.
 *
 * The default export is the plugin. The package also exports the shared
 * Temporal client service (`temporalServiceRef`), the extension point for
 * enrichers and custom actions (`temporalExtensionPoint`), and the
 * permissions, types and annotation constants of the plugin, for permission
 * policies and modules.
 *
 * @packageDocumentation
 */

export { temporalPlugin as default } from './plugin';
export * from './service/TemporalService';
export * from './extensions';
export * from '@kwkevinchan/backstage-plugin-temporal-common';
