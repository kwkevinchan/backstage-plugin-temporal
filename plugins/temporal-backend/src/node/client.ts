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
  buildWorkflowRunPath,
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowListResponse,
  WorkflowMessageResponse,
  WorkflowRef,
  WorkflowRunRef,
  WorkflowStartRequest,
  WorkflowResultResponse,
  WorkflowStartResponse,
  WorkflowStatus,
  WORKFLOWS_PATH,
} from '../common';

/**
 * The message of a 404 without an error body from a route that changes
 * workflows: the Temporal backend serves no such route because
 * `temporal.control.enabled` is false there. That backend may be another
 * deployment, so its config cannot be read here.
 *
 * @public
 */
export const CONTROL_DISABLED_MESSAGE =
  'The Temporal backend plugin does not serve the operations that change workflows: temporal.control.enabled is false in the app-config of the backend that runs it. Set temporal.control.enabled to true there (it is the default) to start, signal or update workflows';

/**
 * Builds the link to a run on the Workflows page of the frontend plugin.
 *
 * @param appBaseUrl - `app.baseUrl`
 * @public
 */
export function buildWorkflowUrl(
  appBaseUrl: string,
  ref: WorkflowRunRef,
): string {
  return `${appBaseUrl.replace(/\/$/, '')}/temporal${buildWorkflowRunPath(
    ref,
  )}`;
}

/**
 * The run an operation was refused on because it continued as new (a 409
 * with `continuedAsNewRunId`), else undefined.
 *
 * @public
 */
export function continuedAsNewRunIdOf(error: unknown): string | undefined {
  if (!(error instanceof ResponseError) || error.response.status !== 409) {
    return undefined;
  }
  const runId = (error.body.error as { continuedAsNewRunId?: unknown })
    .continuedAsNewRunId;
  return typeof runId === 'string' && runId ? runId : undefined;
}

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
 * Calls the routes of the Temporal backend plugin on behalf of a user, so
 * that its permission checks, audit records and search attributes apply as
 * when the user uses the pages. For backend modules that act for a user, for
 * example scaffolder actions and actions of the actions registry.
 *
 * @public
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
        'The Temporal plugin refused the credentials of the user; their token may have expired (it lasts about an hour)',
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

  /**
   * One page of the runs of an entity (and of the TemporalWorkflow entities
   * it depends on), newest first.
   */
  listEntityWorkflows(
    entityRef: string,
    options: { status?: WorkflowStatus; pageSize?: number },
    credentials: BackstageCredentials,
  ): Promise<WorkflowListResponse> {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.pageSize) params.set('pageSize', String(options.pageSize));
    const search = params.toString() ? `?${params}` : '';
    return this.call(
      'GET',
      buildEntityWorkflowsPath(parseEntityRef(entityRef)) + search,
      credentials,
    );
  }

  /** The steps of a run, with their status; needs the read permission. */
  graph(
    ref: WorkflowRunRef,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<WorkflowGraphResponse> {
    return this.call(
      'GET',
      `${buildWorkflowRunPath(ref)}/graph${query(entityRef)}`,
      credentials,
    );
  }

  describe(
    ref: WorkflowRunRef,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<WorkflowDetail> {
    return this.call(
      'GET',
      buildWorkflowRunPath(ref) + query(entityRef),
      credentials,
    );
  }

  /**
   * The run ID of the first run in the run list of a workflow ID (the one
   * running, else the one that closed last), or undefined when the list has
   * none yet: a workflow that has just started can take a moment to be
   * listed.
   */
  async latestRunId(
    ref: Pick<WorkflowRef, 'namespace' | 'workflowId'>,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<string | undefined> {
    const params = new URLSearchParams({ pageSize: '1' });
    if (entityRef) params.set('entityRef', entityRef);
    const list = await this.call<WorkflowListResponse>(
      'GET',
      `${buildWorkflowPath(ref)}?${params}`,
      credentials,
    );
    return list.items[0]?.runId;
  }

  /** The workflow's result or failure; needs the history permission. */
  result(
    ref: WorkflowRunRef,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<WorkflowResultResponse> {
    return this.call(
      'GET',
      `${buildWorkflowRunPath(ref)}/result${query(entityRef)}`,
      credentials,
    );
  }

  /** Sends a signal (no result) or an update (its result). */
  send(
    kind: 'signal' | 'update',
    ref: WorkflowRunRef,
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
