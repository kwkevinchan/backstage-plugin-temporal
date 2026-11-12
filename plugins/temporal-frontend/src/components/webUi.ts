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

import { configApiRef, useApi } from '@backstage/core-plugin-api';
import {
  isValidNamespaceName,
  isValidTaskQueueName,
  isValidWorkflowTypeName,
} from '../common';

/** `temporal.webUi.baseUrl` without a trailing slash, when it is set. */
export function useTemporalWebUiBaseUrl(): string | undefined {
  const config = useApi(configApiRef);
  return config
    .getOptionalString('temporal.webUi.baseUrl')
    ?.replace(/\/+$/, '');
}

/** `temporal.connection.defaultNamespace`, or `default`. */
export function useTemporalDefaultNamespace(): string {
  const config = useApi(configApiRef);
  return (
    config.getOptionalString('temporal.connection.defaultNamespace') ??
    'default'
  );
}

/**
 * Link to the Temporal Web UI list of the runs of a workflow type, or
 * undefined when a name has characters that are not allowed.
 */
export function workflowTypeWebUiUrl(
  baseUrl: string,
  options: { namespace: string; workflowType: string; taskQueue?: string },
): string | undefined {
  const { namespace, workflowType, taskQueue } = options;
  if (
    !isValidNamespaceName(namespace) ||
    !isValidWorkflowTypeName(workflowType) ||
    (taskQueue !== undefined && !isValidTaskQueueName(taskQueue))
  ) {
    return undefined;
  }
  const conditions = [`WorkflowType="${workflowType}"`];
  if (taskQueue) conditions.push(`TaskQueue="${taskQueue}"`);
  return `${baseUrl}/namespaces/${encodeURIComponent(
    namespace,
  )}/workflows?query=${encodeURIComponent(conditions.join(' AND '))}`;
}
