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

import type {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { ResponseError } from '@backstage/errors';
import type { JsonValue } from '@backstage/types';
import {
  buildEntityWorkflowsPath,
  buildWorkflowOperationPath,
  buildWorkflowPath,
  WorkflowDetail,
  WorkflowMessageResponse,
  WorkflowRef,
  WorkflowStartRequest,
  WorkflowStartResponse,
  WorkflowStepsResponse,
  WORKFLOWS_PATH,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';

/**
 * The message of a 404 without an error body from a route that changes
 * workflows: the Temporal backend serves no such route because
 * `temporal.control.enabled` is false there. That backend may be another
 * deployment, so its config cannot be read here.
 */
export const CONTROL_DISABLED_MESSAGE =
  'The Temporal backend plugin does not serve the operations that change workflows: temporal.control.enabled is false in the app-config of the backend that runs it. Set temporal.control.enabled to true there (it is the default) to start, signal or update workflows from templates';

/** True when a response carries a Backstage error body (`{ error }`). */
async function hasErrorBody(response: Response): Promise<boolean> {
  try {
    const body = JSON.parse(await response.text());
    return typeof body?.error?.name === 'string';
  } catch {
    return false;
  }
}

/**
 * Calls the routes of the Temporal backend plugin on behalf of the user who
 * runs the template, so that its permission checks, audit records and
 * search attributes apply as when the user uses the pages.
 */
export class TemporalPluginClient {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly auth: AuthService,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    credentials: BackstageCredentials,
    body?: unknown,
    options?: { control?: boolean },
  ): Promise<T> {
    const baseUrl = await this.discovery.getBaseUrl('temporal');
    const { token } = await this.auth.getPluginRequestToken({
      onBehalfOf: credentials,
      targetPluginId: 'temporal',
    });
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      throw new Error(
        'The Temporal plugin refused the credentials of the user who runs the template; their token may have expired (it lasts about an hour from when the task was created)',
      );
    }
    // A route that changes workflows answers 404 without an error body when
    // it does not exist; the plugin's own 404s (an unknown entity or
    // workflow) have one.
    if (
      response.status === 404 &&
      options?.control &&
      !(await hasErrorBody(response.clone()))
    ) {
      throw new Error(CONTROL_DISABLED_MESSAGE);
    }
    if (!response.ok) throw await ResponseError.fromResponse(response);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Starts a workflow: of an entity (its workflow type and task queue unless
   * given), or any workflow type, which needs the list permission too.
   */
  start(
    request: WorkflowStartRequest & { entityRef?: string },
    credentials: BackstageCredentials,
  ): Promise<WorkflowStartResponse> {
    const { entityRef, ...body } = request;
    const path = entityRef
      ? buildEntityWorkflowsPath(parseEntityRef(entityRef))
      : WORKFLOWS_PATH;
    return this.call('POST', path, credentials, body, { control: true });
  }

  describe(
    ref: WorkflowRef,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<WorkflowDetail> {
    return this.call(
      'GET',
      buildWorkflowPath(ref) + query(entityRef),
      credentials,
    );
  }

  /** The workflow's input and result; needs the history permission. */
  steps(
    ref: WorkflowRef,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<WorkflowStepsResponse> {
    return this.call(
      'GET',
      `${buildWorkflowPath(ref)}/steps${query(entityRef)}`,
      credentials,
    );
  }

  /** Sends a signal (no result) or an update (its result). */
  send(
    kind: 'signal' | 'update',
    ref: WorkflowRef,
    message: { name: string; args: JsonValue[] },
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<WorkflowMessageResponse | undefined> {
    return this.call(
      'POST',
      buildWorkflowOperationPath(ref, kind) + query(entityRef),
      credentials,
      message,
      { control: true },
    );
  }
}

function query(entityRef: string | undefined): string {
  return entityRef ? `?${new URLSearchParams({ entityRef })}` : '';
}
