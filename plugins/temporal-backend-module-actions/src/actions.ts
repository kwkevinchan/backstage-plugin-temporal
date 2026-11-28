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

import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
  ResponseError,
} from '@backstage/errors';
import type {
  ActionsRegistryActionOptions,
  ActionsRegistryService,
} from '@backstage/backend-plugin-api/alpha';
import type {
  AuthService,
  BackstageCredentials,
} from '@backstage/backend-plugin-api';
import type { JsonValue } from '@backstage/types';
import {
  exampleArgs,
  WORKFLOW_STATUSES,
  type WorkflowFailure,
  type WorkflowGraphNode,
  type WorkflowGraphResponse,
  type WorkflowMessageResponse,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import {
  buildWorkflowUrl,
  continuedAsNewRunIdOf,
  resolveWorkflowNamespace,
  type TemporalPluginClient,
  type WorkflowNamespaceOptions,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';

/** The zod that the registry gives to a schema. */
type Zod = Parameters<
  ActionsRegistryActionOptions<any, any>['schema']['input']
>[0];

export interface TemporalActionsOptions extends WorkflowNamespaceOptions {
  client: TemporalPluginClient;
  auth: AuthService;
  /** `app.baseUrl`, for the link to the workflow. */
  appBaseUrl: string;
  /** The path of the Temporal page (`temporal.pagePath`), for the link. */
  pagePath?: string;
  /**
   * Allow service principals to invoke workflow-changing actions. Defaults to
   * false.
   */
  allowServiceWrites?: boolean;
}

/** The most runs that list-workflows returns. */
const MAX_LIST_LIMIT = 50;
/** The most step names that get-workflow returns. */
const MAX_CURRENT_STEPS = 10;

/** Added to an error of an action on an existing workflow when no entityRef was given. */
const ENTITY_REF_HINT =
  ' You gave no entityRef: call again once with the entityRef of the entity that you listed the workflow with.';

/**
 * An answer of the Temporal backend plugin as an error that carries its
 * message: a `ResponseError` only says "Request failed with 400", and an
 * assistant reads the message. A refusal (403) also says what to do.
 */
function readable(error: unknown, gaveEntityRef: boolean): unknown {
  if (!(error instanceof ResponseError)) return error;
  const status = error.response.status;
  const message = error.body.error.message || error.message;
  // Without entityRef the plugin checks the permissions of the whole
  // namespace, which a user may lack although they may read the entity's
  // workflows.
  const entityHint = gaveEntityRef ? '' : ENTITY_REF_HINT;
  switch (status) {
    case 400:
      return new InputError(message);
    case 403:
      return new NotAllowedError(
        gaveEntityRef
          ? `The Temporal plugin refused this for the signed-in user: ${message}. Do not retry; tell the user that they lack the permission.`
          : `The Temporal plugin refused this for the signed-in user: ${message}.${entityHint} If that is refused too, do not retry; tell the user that they lack the permission.`,
      );
    case 404:
      return new NotFoundError(
        entityHint ? `${message.replace(/\.$/, '')}.${entityHint}` : message,
      );
    case 409:
      return new ConflictError(message);
    default:
      // The message of a server error may carry internal detail (hosts,
      // queries, stack text) that an assistant would pass on to the user.
      return new Error(
        status >= 500
          ? `The Temporal plugin answered ${status}. Do not retry more than once; tell the user that the Temporal plugin is failing.`
          : `The Temporal plugin answered ${status}: ${message}`,
      );
  }
}

/**
 * The step kinds that the backend counts in `completedSteps` and `totalSteps`
 * (`services/graph.ts`), and the open and failed statuses of
 * `services/stepStatus.ts`. A test compares these sets with the ones of the
 * backend.
 */
export const STEP_KINDS = new Set<WorkflowGraphNode['kind']>([
  'activity',
  'timer',
  'childWorkflow',
  'update',
  'signalSent',
]);
export const RUNNING = new Set<WorkflowGraphNode['status']>([
  'Scheduled',
  'Running',
  'Retrying',
  'Waiting',
]);
export const FAILED = new Set<WorkflowGraphNode['status']>([
  'Failed',
  'TimedOut',
  'Terminated',
  'Rejected',
]);

/** Counts of the steps of a run, and the names of those that run now. */
function summarizeSteps(graph: WorkflowGraphResponse) {
  const steps = graph.nodes.filter(
    n => STEP_KINDS.has(n.kind) && n.internal !== true,
  );
  return {
    completed: graph.completedSteps,
    running: steps.filter(n => RUNNING.has(n.status)).length,
    failed: steps.filter(n => FAILED.has(n.status)).length,
    seen: graph.totalSteps,
    truncated: graph.truncated,
    currentSteps: steps
      .filter(n => RUNNING.has(n.status))
      .slice(0, MAX_CURRENT_STEPS)
      .map(n => n.name),
    ...(graph.current ? { current: graph.current } : {}),
  };
}

/** The failure as text lines: its message, then its causes. */
function describeFailure(failure: WorkflowFailure) {
  const causes: string[] = [];
  for (let c = failure.cause; c; c = c.cause) causes.push(c.message);
  return {
    message: failure.message,
    ...(failure.kind ? { kind: failure.kind } : {}),
    ...(failure.type ? { type: failure.type } : {}),
    ...(causes.length ? { causes } : {}),
  };
}

/** Registers the Temporal actions in the actions registry. */
export function registerTemporalActions(
  registry: ActionsRegistryService,
  options: TemporalActionsOptions,
): void {
  const { client } = options;

  /**
   * Registers an action whose errors are {@link readable}. The hint to give
   * the entityRef of a listed workflow is for actions on existing workflows,
   * not for a start, where an entityRef also changes the namespace.
   */
  const register: ActionsRegistryService['register'] = action =>
    registry.register({
      ...action,
      async action(context) {
        if (
          action.attributes?.readOnly !== true &&
          !options.allowServiceWrites &&
          options.auth.isPrincipal(context.credentials, 'service')
        ) {
          throw new NotAllowedError(
            `Service principals cannot call ${action.name} by default. Connect with a signed-in user token so per-user permissions apply, or set temporal.actions.allowServiceWrites: true to opt in.`,
          );
        }
        try {
          return await action.action(context);
        } catch (error) {
          throw readable(
            error,
            action.name === 'start-workflow' ||
              Boolean((context.input as { entityRef?: string }).entityRef),
          );
        }
      },
    });

  /** Namespace and run of the workflow named in the input. */
  async function locate(
    input: {
      workflowId: string;
      runId?: string;
      namespace?: string;
      entityRef?: string;
    },
    credentials: BackstageCredentials,
  ) {
    const base = {
      namespace: await resolveWorkflowNamespace(options, input, credentials),
      workflowId: input.workflowId,
    };
    const runId =
      input.runId ??
      (await client.latestRunId(base, input.entityRef, credentials));
    if (!runId) {
      throw new NotFoundError(
        `No run of workflow ${input.workflowId} was found in namespace ${
          base.namespace
        }; check the workflow ID and namespace with list-workflows.${
          input.entityRef ? '' : ENTITY_REF_HINT
        }`,
      );
    }
    return { ...base, runId };
  }

  register({
    name: 'list-workflows',
    title: 'List Temporal workflow runs of an entity',
    description:
      'Lists the most recent Temporal workflow runs of a catalog entity, newest first, with their status. Use it to find the workflowId, runId and namespace that get-workflow, signal-workflow and update-workflow need, or to see what is running or has failed. Each item has a workflowUrl, the page of the run in Backstage. Only reads; it shows what the signed-in user may read.',
    attributes: { readOnly: true, destructive: false, idempotent: true },
    schema: {
      input: z =>
        z.object({
          entityRef: z
            .string()
            .min(1)
            .describe(
              'Catalog entity reference whose workflows to list, for example component:default/orders',
            ),
          status: z
            .enum(WORKFLOW_STATUSES as [string, ...string[]])
            .optional()
            .describe('Only runs with this status; all statuses when left out'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_LIST_LIMIT)
            .optional()
            .describe(
              `How many runs to return, at most ${MAX_LIST_LIMIT}; 10 by default`,
            ),
        }),
      output: z =>
        z.object({
          items: z
            .array(
              z.object({
                namespace: z.string().describe('Temporal namespace'),
                workflowId: z.string(),
                runId: z.string(),
                workflowType: z.string(),
                status: z
                  .string()
                  .describe(
                    'Running, Completed, Failed, Canceled, Terminated, ContinuedAsNew, TimedOut or Unknown',
                  ),
                startTime: z.string().optional().describe('ISO 8601 time'),
                closeTime: z
                  .string()
                  .optional()
                  .describe('ISO 8601 time; left out while the run is open'),
                initiator: z
                  .string()
                  .optional()
                  .describe(
                    'Entity reference of the user who started it, when the plugin records it',
                  ),
                workflowUrl: z
                  .string()
                  .describe('Link to the run in Backstage'),
              }),
            )
            .describe('Runs, newest first'),
          hasMore: z
            .boolean()
            .describe(
              'True when the entity has more runs than limit; ask for a status or a smaller question instead of paging',
            ),
        }),
    },
    async action({ input, credentials }) {
      const limit = input.limit ?? 10;
      const page = await client.listEntityWorkflows(
        input.entityRef,
        { status: input.status as any, pageSize: limit },
        credentials,
      );
      const items = page.items.slice(0, limit);
      return {
        output: {
          items: items.map(w => ({
            namespace: w.namespace,
            workflowId: w.workflowId,
            runId: w.runId,
            workflowType: w.workflowType,
            status: w.status,
            startTime: w.startTime,
            closeTime: w.closeTime,
            initiator: w.initiator,
            workflowUrl: buildWorkflowUrl(options.appBaseUrl, w, {
              pagePath: options.pagePath,
            }),
          })),
          hasMore: Boolean(page.nextPageToken) || page.items.length > limit,
        },
      };
    },
  });

  const workflowFields = (z: Zod) => ({
    workflowId: z.string().min(1).describe('Workflow ID, from list-workflows'),
    runId: z
      .string()
      .optional()
      .describe('Run ID; the latest run of the workflow ID when left out'),
    namespace: z
      .string()
      .optional()
      .describe(
        'Temporal namespace, as list-workflows returns it; else the namespace of entityRef, else the default one',
      ),
    entityRef: z
      .string()
      .optional()
      .describe(
        'Catalog entity the workflow belongs to. Give the entityRef that you used with list-workflows whenever you have it: without it the plugin checks the permission for the whole namespace, and can answer not found or refused',
      ),
  });

  register({
    name: 'get-workflow',
    title: 'Get a Temporal workflow run',
    description:
      'Shows one Temporal workflow run: its status, type, start and close time, who started it, a summary of its steps (how many are completed, running and failed, and which run now), the failure of a run that failed, and the link to its page in Backstage. Use it to answer where a workflow is, or why it failed. Only reads. The failure has the message and causes only; stack traces and step payloads are not returned.',
    attributes: { readOnly: true, destructive: false, idempotent: true },
    schema: {
      input: z => z.object(workflowFields(z)),
      output: z =>
        z.object({
          namespace: z.string(),
          workflowId: z.string(),
          runId: z.string(),
          workflowType: z.string(),
          taskQueue: z.string().optional(),
          status: z
            .string()
            .describe(
              'Running, Completed, Failed, Canceled, Terminated, ContinuedAsNew, TimedOut or Unknown',
            ),
          startTime: z.string().optional().describe('ISO 8601 time'),
          closeTime: z
            .string()
            .optional()
            .describe('ISO 8601 time; left out while the run is open'),
          initiator: z
            .string()
            .optional()
            .describe('Entity reference of the user who started it'),
          continuedAsNewRunId: z
            .string()
            .optional()
            .describe(
              'The run this one continued as; read that run for the current state',
            ),
          workflowUrl: z.string().describe('Link to the run in Backstage'),
          steps: z
            .object({
              completed: z.number().describe('Steps that are done'),
              running: z
                .number()
                .describe(
                  'Steps that run or wait now: activities, timers, child workflows, updates and signals sent',
                ),
              failed: z
                .number()
                .describe('Steps that failed or timed out, of the same kinds'),
              seen: z
                .number()
                .describe(
                  'Steps seen so far. Not a total for a running workflow: later steps are not known until they run',
                ),
              truncated: z
                .boolean()
                .describe(
                  'True when the history was longer than the plugin reads; the counts cover only its start',
                ),
              currentSteps: z
                .array(z.string())
                .describe('Names of the steps that run or wait now'),
              current: z
                .string()
                .optional()
                .describe(
                  'Where the run is now: what it waits for or where it failed',
                ),
            })
            .describe('Summary of the steps of the run'),
          failure: z
            .object({
              message: z.string(),
              kind: z.string().optional(),
              type: z.string().optional(),
              causes: z
                .array(z.string())
                .optional()
                .describe(
                  'Messages of the underlying failures, outermost first',
                ),
            })
            .optional()
            .describe('Why a closed run failed; left out for other runs'),
        }),
    },
    async action({ input, credentials }) {
      const ref = await locate(input, credentials);
      const [detail, graph] = await Promise.all([
        client.describe(ref, input.entityRef, credentials),
        client.graph(ref, input.entityRef, credentials),
      ]);
      return {
        output: {
          namespace: detail.namespace,
          workflowId: detail.workflowId,
          runId: detail.runId,
          workflowType: detail.workflowType,
          taskQueue: detail.taskQueue,
          status: detail.status,
          startTime: detail.startTime,
          closeTime: detail.closeTime,
          initiator: detail.initiator,
          continuedAsNewRunId: detail.continuedAsNewRunId,
          workflowUrl: buildWorkflowUrl(options.appBaseUrl, detail, {
            pagePath: options.pagePath,
          }),
          steps: summarizeSteps(graph),
          failure: detail.failure ? describeFailure(detail.failure) : undefined,
        },
      };
    },
  });

  register({
    name: 'start-workflow',
    title: 'Start a Temporal workflow',
    description:
      'Starts a Temporal workflow, as the signed-in user: the workflow of a catalog entity (a TemporalWorkflow entity, or one with the Temporal annotations), or any workflow type with its task queue. It changes things: a new workflow run starts. Ask the user to confirm before you call it. Returns the workflowId and runId to follow it with get-workflow, and the link to its page. Starting with a workflowId that is already running fails; without a workflowId, every call starts a new workflow.',
    attributes: { readOnly: false, idempotent: false },
    schema: {
      input: z =>
        z.object({
          entityRef: z
            .string()
            .optional()
            .describe(
              'Entity whose workflow to start; its workflow type and task queue are used unless given',
            ),
          workflowType: z
            .string()
            .optional()
            .describe('Workflow type; required without entityRef'),
          taskQueue: z
            .string()
            .optional()
            .describe('Task queue; required without entityRef'),
          namespace: z
            .string()
            .optional()
            .describe(
              'Temporal namespace, without entityRef; defaults to the backend default',
            ),
          workflowId: z
            .string()
            .optional()
            .describe(
              'Workflow ID; one is made from the workflow type when left out. Starting again with the same ID fails while that workflow is still running',
            ),
          args: z
            .any()
            .optional()
            .describe(
              'Arguments: an array is the argument list, any other value the only argument',
            ),
        }),
      output: z =>
        z.object({
          namespace: z.string(),
          workflowId: z.string(),
          runId: z.string(),
          workflowUrl: z.string().describe('Link to the run in Backstage'),
        }),
    },
    async action({ input, credentials }) {
      const { entityRef, workflowType, taskQueue, namespace, workflowId } =
        input;
      if (!entityRef && (!workflowType || !taskQueue)) {
        throw new InputError('Give entityRef, or workflowType and taskQueue');
      }
      const started = await client.start(
        {
          entityRef,
          workflowType,
          taskQueue,
          namespace: entityRef ? undefined : namespace,
          workflowId,
          args: exampleArgs(input.args as JsonValue | undefined),
        },
        credentials,
      );
      return {
        output: {
          namespace: started.namespace,
          workflowId: started.workflowId,
          runId: started.runId,
          workflowUrl: buildWorkflowUrl(options.appBaseUrl, started, {
            pagePath: options.pagePath,
          }),
        },
      };
    },
  });

  /** The message fields of signal-workflow and update-workflow. */
  const messageFields = (z: Zod) => ({
    ...workflowFields(z),
    name: z.string().min(1).max(200).describe('Name of the message'),
    args: z
      .any()
      .optional()
      .describe(
        'Arguments: an array is the argument list, any other value the only argument',
      ),
  });

  register({
    name: 'signal-workflow',
    title: 'Send a signal to a Temporal workflow',
    description:
      'Sends a signal to a running Temporal workflow, as the signed-in user, for example to approve a step it waits for. It changes the workflow and cannot be taken back. Ask the user to confirm before you call it. Only the signals that the Temporal plugin allows work; a refused name comes back as an error with the reason. Returns the run that got the signal; the signal has no result, so read the workflow with get-workflow to see what it did.',
    attributes: { readOnly: false, idempotent: false },
    schema: {
      input: z => z.object(messageFields(z)),
      output: z =>
        z.object({
          runId: z.string().describe('The run that the signal was sent to'),
        }),
    },
    async action({ input, credentials }) {
      const args = exampleArgs(input.args as JsonValue | undefined);
      const ref = await locate(input, credentials);
      const send = (runId: string) =>
        client.send(
          'signal',
          { ...ref, runId },
          { name: input.name, args },
          input.entityRef,
          credentials,
        );
      let runId = ref.runId;
      try {
        await send(runId);
      } catch (error) {
        // A signal is sent to one run: when the run found continued as new
        // since, send it once more to the run it continued as.
        const next = input.runId ? undefined : continuedAsNewRunIdOf(error);
        if (!next) throw error;
        runId = next;
        await send(next);
      }
      return { output: { runId } };
    },
  });

  register({
    name: 'update-workflow',
    title: 'Send an update to a Temporal workflow',
    description:
      'Sends an update to a running Temporal workflow, as the signed-in user, and returns its result. Unlike a signal, the workflow answers an update. It changes the workflow and cannot be taken back. Ask the user to confirm before you call it. Only the updates that the Temporal plugin allows work; a refused name comes back as an error with the reason.',
    attributes: { readOnly: false, idempotent: false },
    schema: {
      input: z => z.object(messageFields(z)),
      output: z =>
        z.object({
          runId: z
            .string()
            .describe(
              'The run used to find the workflow; the update acts on the run of its chain that runs now',
            ),
          result: z.any().optional().describe('The result of the update'),
        }),
    },
    async action({ input, credentials }) {
      const args = exampleArgs(input.args as JsonValue | undefined);
      const ref = await locate(input, credentials);
      const response: WorkflowMessageResponse | undefined = await client.send(
        'update',
        ref,
        { name: input.name, args },
        input.entityRef,
        credentials,
      );
      return {
        output: { runId: ref.runId, result: response?.result ?? undefined },
      };
    },
  });
}
