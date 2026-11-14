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

// The alpha API for backend modules, exported from `./alpha`: the access
// service that the plugin and its modules share, and the extension points
// for workflow actions, workflow enrichers and LLM adapters.

import {
  BackstageCredentials,
  createExtensionPoint,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import { createPermissionResourceRef } from '@backstage/plugin-permission-node';
import type { JsonValue } from '@backstage/types';
import type { Client } from '@temporalio/client';
import {
  RESOURCE_TYPE_TEMPORAL_WORKFLOW,
  WorkflowDetail,
  WorkflowLlmRecord,
  WorkflowRef,
  WorkflowSummary,
} from '../common';

/**
 * What a permission rule of the `temporal-workflow` resource type turns
 * into for lists:
 *
 * - a Temporal visibility query, the part after `WHERE`, for example
 *   `WorkflowType = 'orderWorkflow'`;
 * - `{ namespaces }`: the list is of one of these namespaces. A visibility
 *   query cannot filter on the namespace (it is the scope of the list), so
 *   the access service decides it for the namespace being listed;
 * - `{ initiators }`: the workflow was started by one of these users, read
 *   from the search attribute `temporal.searchAttributes.initiator`. Matches
 *   nothing when that attribute is not configured.
 *
 * @alpha
 */
export type TemporalWorkflowQuery =
  | string
  | { namespaces: string[] }
  | { initiators: string[] };

/**
 * The `temporal-workflow` permission resource: a workflow, checked with
 * `temporal.workflow.list` and `temporal.workflow.history.list` when it is
 * opened without a catalog entity. Rules apply to the workflow summary and
 * turn into a visibility query for lists. Add rules with a module of the
 * temporal plugin and `coreServices.permissionsRegistry.addPermissionRules`.
 *
 * @alpha
 */
export const temporalWorkflowPermissionResourceRef =
  createPermissionResourceRef<WorkflowSummary, TemporalWorkflowQuery>().with({
    pluginId: 'temporal',
    resourceType: RESOURCE_TYPE_TEMPORAL_WORKFLOW,
  });

/**
 * `read` for the details and step graph of a workflow, `history` for its
 * history, inputs and results.
 *
 * @alpha
 */
export type TemporalWorkflowAccessLevel = 'read' | 'history';

/**
 * A catalog entity whose workflows are shown, after the access checks.
 *
 * @alpha
 */
export interface TemporalEntityContext {
  entity: Entity;
  entityRef: string;
  /** The Temporal namespace of the entity's workflows. */
  namespace: string;
  /**
   * The `TemporalWorkflow` entities the entity depends on that the caller
   * has the same permission on. Their workflows count as the entity's.
   */
  relatedWorkflowEntities: Entity[];
}

/**
 * A workflow that passed the access checks.
 *
 * @alpha
 */
export interface TemporalAccessibleWorkflow {
  /**
   * The entity the workflow is shown for. Undefined when it was opened
   * without one (the Workflows page) under the list permissions.
   */
  context?: TemporalEntityContext;
  workflow: WorkflowDetail;
}

/**
 * Decides who may see and change which workflows, with the permission
 * framework and the catalog. The Temporal backend plugin and its modules
 * share one instance; replace its factory to change how access is decided.
 *
 * @alpha
 */
export interface TemporalAccessService {
  /**
   * True when the policy allows `temporal.workflow.list` without
   * conditions: the caller may list and open every workflow.
   */
  canListAll(credentials: BackstageCredentials): Promise<boolean>;

  /**
   * Checks `temporal.workflow.list` for the Workflows page, listing
   * `namespace`. Returns undefined when every workflow of it may be listed,
   * or the visibility query the list must also match (a conditional
   * decision). Throws `InputError` when the namespace is not allowed and
   * `NotAllowedError` when the caller may not list workflows, or the
   * conditions match no workflow of the namespace. The namespace is a
   * parameter because Temporal's visibility queries cannot filter on it:
   * conditions on the namespace are decided here.
   */
  authorizeWorkflowList(
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<string | undefined>;

  /** True when the caller may see the inputs and results of a workflow. */
  canReadPayloads(
    workflow: TemporalAccessibleWorkflow,
    credentials: BackstageCredentials,
  ): Promise<boolean>;

  /**
   * Checks a permission on an entity, or, without an entity, that the
   * policy allows it for every entity (an unconditional ALLOW). Throws
   * `NotAllowedError` otherwise.
   */
  authorizeOn(
    permission: ResourcePermission<'catalog-entity'>,
    entityRef: string | undefined,
    credentials: BackstageCredentials,
  ): Promise<void>;

  /**
   * Checks the permission on the entity, then reads it (and the
   * `TemporalWorkflow` entities it depends on) with the caller's
   * credentials.
   */
  loadEntity(
    entityRef: string,
    permission: ResourcePermission<'catalog-entity'>,
    credentials: BackstageCredentials,
  ): Promise<TemporalEntityContext>;

  /**
   * Reads a workflow with every check: the namespace is allowed, the
   * caller has the permission of `level` on the entity it belongs to
   * (`entityRef`, else the entity in its search attribute), or the list
   * permissions when opened without an entity.
   */
  loadWorkflow(
    ref: WorkflowRef,
    options: {
      entityRef?: string;
      level: TemporalWorkflowAccessLevel;
      credentials: BackstageCredentials;
    },
  ): Promise<TemporalAccessibleWorkflow>;

  /**
   * Adds `workflowEntityRef` to runs that match a `TemporalWorkflow`
   * entity the caller can see.
   */
  linkWorkflowEntities(
    items: WorkflowSummary[],
    namespace: string,
    credentials: BackstageCredentials,
  ): Promise<WorkflowSummary[]>;
}

/**
 * The access service of the Temporal backend plugin (plugin scope). The
 * default export of the package installs its default factory
 * (`temporalAccessServiceFactory`).
 *
 * @alpha
 */
export const temporalAccessServiceRef = createServiceRef<TemporalAccessService>(
  {
    id: 'temporal.access',
    scope: 'plugin',
  },
);

/**
 * Context passed to a {@link TemporalControlAction}.
 *
 * @alpha
 */
export interface TemporalControlActionContext {
  /**
   * The entity the workflow belongs to. Undefined for a workflow opened from
   * the Workflows page that is not linked to an entity.
   */
  entity?: Entity;
  /** The workflow the action runs on, as read just before. */
  workflow: WorkflowDetail;
  credentials: BackstageCredentials;
  /**
   * The client the plugin changes workflows with (today the shared
   * connection of `temporalServiceRef`). It reaches every workflow of the
   * namespace, but the permission was only checked for `workflow`: an action
   * that changes other workflows must check those itself.
   */
  client: Client;
}

/**
 * A custom action on a workflow, served as `POST .../actions/:actionId`.
 * The backend reads the workflow and checks `permission` on its entity
 * before `handle` runs, and records the call with the auditor. `body` is
 * the JSON request body. The returned value is sent back as `{ result }`.
 *
 * @alpha
 */
export interface TemporalControlAction {
  /** Letters, digits, `.`, `_` and `-`, starting with a letter. */
  id: string;
  permission: ResourcePermission<'catalog-entity'>;
  /** Only allow the action when this returns true, for example on running workflows. */
  filter?: (workflow: WorkflowDetail) => boolean;
  handle(
    ref: Required<WorkflowRef>,
    body: JsonValue | undefined,
    context: TemporalControlActionContext,
  ): Promise<JsonValue | void>;
}

/**
 * Extension point for custom workflow actions, served as
 * `POST .../actions/:actionId`.
 *
 * @alpha
 */
export interface TemporalControlExtensionPoint {
  addControlAction(action: TemporalControlAction): void;
}

/**
 * Extension point for custom workflow actions. The plugin always registers
 * it; when `temporal.control.enabled` is false, the actions added are
 * ignored with a warning and their routes are not served.
 *
 * @alpha
 */
export const temporalControlExtensionPoint =
  createExtensionPoint<TemporalControlExtensionPoint>({
    id: 'temporal.control',
  });

/**
 * Context passed to a {@link TemporalWorkflowEnricher}.
 *
 * @alpha
 */
export interface TemporalWorkflowEnricherContext {
  /**
   * The entity whose workflows are shown. Enrichers should handle it being
   * undefined: lists that span entities (the Workflows page) may run
   * enrichers without one in a later version.
   */
  entity?: Entity;
  namespace: string;
  credentials: BackstageCredentials;
}

/**
 * Adds data to workflow summaries before they are returned to the frontend.
 * Enrichers run in the order they were added, on list results and on the
 * workflow details. Put added data under `extensions[id]`.
 *
 * @alpha
 */
export interface TemporalWorkflowEnricher {
  id: string;
  enrich(
    items: WorkflowSummary[],
    context: TemporalWorkflowEnricherContext,
  ): Promise<WorkflowSummary[]>;
}

/**
 * Extension point for workflow enrichers. It only adds enrichers; custom
 * workflow actions are added with {@link TemporalControlExtensionPoint}.
 *
 * @alpha
 */
export interface TemporalWorkflowEnricherExtensionPoint {
  addWorkflowEnricher(enricher: TemporalWorkflowEnricher): void;
}

/**
 * Extension point for workflow enrichers: `addWorkflowEnricher()` adds data
 * to workflow summaries. It cannot add actions; use
 * `temporalControlExtensionPoint` for those.
 *
 * @alpha
 */
export const temporalWorkflowEnricherExtensionPoint =
  createExtensionPoint<TemporalWorkflowEnricherExtensionPoint>({
    id: 'temporal.workflow-enrichers',
  });

/**
 * A step of a run as LLM adapters see it: what the history says about it
 * without decoding payloads.
 *
 * @alpha
 */
export interface TemporalLlmStep {
  /**
   * An activity, or a local activity (a marker in the history). Model calls
   * are read from activities only; local activities are only asked
   * `readToolCall`.
   */
  kind: 'activity' | 'localActivity';
  activityType: string;
  /** Activity ID; for local activities only when the SDK records it. */
  activityId?: string;
  /**
   * The summary text of the step (Temporal's user metadata), first line,
   * when it is plain JSON. A payload codec encodes it.
   */
  summary?: string;
}

/**
 * The decoded payloads of a step. A payload that a codec encoded, or one
 * in External Storage that the backend does not read here, is left out.
 *
 * @alpha
 */
export interface TemporalLlmStepPayloads {
  /** The arguments, when all of them are readable. */
  input?: JsonValue[];
  /** The result of the completed step. */
  result?: JsonValue;
  /**
   * The failure details of the step's failed attempts, newest first; left
   * out once the step completed.
   */
  failureDetails?: JsonValue[];
}

/**
 * One model call read from a step.
 *
 * @alpha
 */
export interface TemporalLlmModelCall {
  /** Name of the call, when the step records one. */
  name?: string;
  /**
   * The call in the plugin's format. Leave it out when the step has no
   * readable record of it yet (for example while it runs).
   */
  record?: WorkflowLlmRecord;
  /** The data the record was read from, shown as raw JSON. */
  raw?: JsonValue;
}

/**
 * A step that ran a tool a model call asked for.
 *
 * @alpha
 */
export interface TemporalLlmToolStep {
  /** The tool name, when the step records it. */
  toolName?: string;
  /** The tool call ID from the model, when the step records it. */
  toolCallId?: string;
  /** Name of the model call that asked for it, when the step records it. */
  modelCall?: string;
}

/**
 * Recognizes the model calls and tool calls of one framework in a run's
 * history and turns them into the plugin's format. The backend asks the
 * adapters in order (the ones modules added, then the built-in ones); the
 * first that reads a step decides. An adapter that throws, or returns
 * something that is not of these types or not plain JSON (cycles,
 * functions, class instances), makes the step a plain step, and the
 * backend logs a warning with the adapter ID, the event ID of the step and
 * the name of the error, once per adapter each time a run is read. The
 * message of the error is neither logged nor returned.
 *
 * Steps are matched by plain names that anyone can give their activities,
 * so check the shape of the payloads before you read a step as yours.
 *
 * @alpha
 */
export interface TemporalLlmAdapter {
  /**
   * Unique ID, shown as the framework of the calls it reads, for example
   * `vercel-ai-sdk`.
   */
  id: string;
  /**
   * True when the step may be a model call of this framework, from what
   * the history says without payloads (usually the activity type). The
   * backend then calls `readModelCalls`. For the graph it reads the result
   * from External Storage, not the input: an input stored there is left
   * out, and only the full record route (`/llm-calls`) passes it. True for
   * a local activity has no effect, and is logged once.
   */
  isModelCall(step: TemporalLlmStep): boolean;
  /**
   * The model calls of a step that `isModelCall` accepted, in order:
   * usually one, several when the step runs a whole agent (at most 100;
   * more make the step a plain step). An empty list
   * when the payloads do not have the framework's shape (the step is then
   * offered to the next adapter, and is otherwise a plain step).
   */
  readModelCalls(
    step: TemporalLlmStep,
    payloads: TemporalLlmStepPayloads,
  ): TemporalLlmModelCall[];
  /**
   * Whether a step that is not a model call ran a tool a model call asked
   * for. Undefined when it is not (or not known to be): the backend still
   * links steps whose name and arguments match a tool call (`inferred`).
   */
  readToolCall?(
    step: TemporalLlmStep,
    payloads: TemporalLlmStepPayloads,
  ): TemporalLlmToolStep | undefined;
}

/**
 * Extension point for LLM adapters.
 *
 * @alpha
 */
export interface TemporalLlmAdapterExtensionPoint {
  addLlmAdapter(adapter: TemporalLlmAdapter): void;
}

/**
 * Extension point for LLM adapters: `addLlmAdapter()` teaches the backend
 * the model calls of another framework. Adapters added here are asked
 * before the built-in ones (`vercel-ai-sdk`, `openai-agents`); an ID that
 * is taken fails the backend start.
 *
 * @alpha
 */
export const temporalLlmAdapterExtensionPoint =
  createExtensionPoint<TemporalLlmAdapterExtensionPoint>({
    id: 'temporal.llm-adapters',
  });
