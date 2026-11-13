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

import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { InputError, NotFoundError } from '@backstage/errors';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import type { JsonValue } from '@backstage/types';
import {
  buildWorkflowPath,
  exampleArgs,
  getTemporalWorkflowSource,
  InvalidTemporalAnnotationError,
  InvalidTemporalWorkflowSpecError,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import { TemporalPluginClient } from './client';

/** Options of the Temporal template actions. */
export interface TemporalActionsOptions {
  client: TemporalPluginClient;
  /** Reads the entity whose namespace wait and signal follow. */
  catalog: CatalogService;
  /** `app.baseUrl`, for the link to the workflow. */
  appBaseUrl: string;
  /**
   * The namespace that the Temporal backend plugin uses when none is given
   * (`temporal.connection.defaultNamespace`). The routes of one workflow
   * have the namespace in their path, so wait and signal fill it in: the
   * given one, else the namespace of the entity, else this one.
   */
  defaultNamespace: string;
}

/** Link to the workflow on the Workflows page of the frontend plugin. */
function workflowUrl(appBaseUrl: string, ref: WorkflowRef): string {
  return `${appBaseUrl.replace(/\/$/, '')}/temporal${buildWorkflowPath(ref)}`;
}

/**
 * The namespace of wait and signal: the one given, else the namespace of the
 * entity (read as the user, by the same function the backend uses when it
 * starts the workflow of an entity), else the default one.
 */
async function resolveNamespace(
  options: TemporalActionsOptions,
  input: { namespace?: string; entityRef?: string },
  credentials: BackstageCredentials,
): Promise<string> {
  if (input.namespace) return input.namespace;
  if (!input.entityRef) return options.defaultNamespace;
  const entity = await options.catalog.getEntityByRef(input.entityRef, {
    credentials,
  });
  if (!entity) {
    throw new NotFoundError(
      `Cannot read the entity ${input.entityRef} to find its Temporal namespace: it does not exist, or you may not read it. Give namespace to skip this lookup`,
    );
  }
  try {
    return (
      getTemporalWorkflowSource(entity).namespace ?? options.defaultNamespace
    );
  } catch (error) {
    if (
      error instanceof InvalidTemporalAnnotationError ||
      error instanceof InvalidTemporalWorkflowSpecError
    ) {
      throw new InputError(error.message);
    }
    throw error;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('The task was cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('The task was cancelled'));
      },
      { once: true },
    );
  });
}

/** Fields that name one workflow, for wait and signal. */
const workflowInput = {
  workflowId: (z: any) =>
    z
      .string()
      .min(1)
      .describe(
        'Workflow ID, for example the output of temporal:workflow:start',
      ),
  runId: (z: any) =>
    z.string().optional().describe('Run ID; the latest run when left out'),
  namespace: (z: any) =>
    z
      .string()
      .optional()
      .describe(
        'Temporal namespace; defaults to the namespace of entityRef, else the backend default (temporal.connection.defaultNamespace)',
      ),
  entityRef: (z: any) =>
    z
      .string()
      .optional()
      .describe(
        'Entity the workflow belongs to, whose permissions are checked; else the entity in its search attribute, or the list permissions',
      ),
};

/**
 * `temporal:workflow:start`: starts a workflow as the user who runs the
 * template.
 */
export function createTemporalWorkflowStartAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:start',
    description:
      'Starts a Temporal workflow: the workflow of an entity (a TemporalWorkflow entity, or one with the Temporal annotations), or any workflow type with its task queue. Checked with temporal.workflow.start as the user who runs the template.',
    examples: [
      {
        description: 'Start the workflow of a TemporalWorkflow entity',
        example: [
          'steps:',
          '  - id: start',
          '    action: temporal:workflow:start',
          '    input:',
          '      entityRef: temporalworkflow:default/release',
          '      args:',
          '        service: ${{ parameters.service }}',
        ].join('\n'),
      },
    ],
    schema: {
      input: {
        entityRef: z =>
          z
            .string()
            .optional()
            .describe(
              'Entity whose workflow to start; its workflow type and task queue are used unless given',
            ),
        workflowType: z =>
          z
            .string()
            .optional()
            .describe('Workflow type; required without entityRef'),
        taskQueue: z =>
          z
            .string()
            .optional()
            .describe('Task queue; required without entityRef'),
        namespace: z =>
          z
            .string()
            .optional()
            .describe(
              'Temporal namespace, without entityRef; defaults to the backend default',
            ),
        workflowId: z =>
          z
            .string()
            .optional()
            .describe(
              'Workflow ID; one is made from the workflow type when left out',
            ),
        args: z =>
          z
            .any()
            .optional()
            .describe(
              'Arguments: an array is the argument list, any other value the only argument',
            ),
      },
      output: {
        namespace: z => z.string(),
        workflowId: z => z.string(),
        runId: z => z.string(),
        workflowUrl: z =>
          z.string().describe('Link to the workflow in Backstage'),
      },
    },
    async handler(ctx) {
      const { entityRef, workflowType, taskQueue, namespace, workflowId } =
        ctx.input;
      if (!entityRef && (!workflowType || !taskQueue)) {
        throw new InputError('Give entityRef, or workflowType and taskQueue');
      }
      const args = exampleArgs(ctx.input.args as JsonValue | undefined);
      if (ctx.isDryRun) {
        ctx.logger.info(
          `Dry run: would start ${workflowType ?? entityRef} with ${
            args.length
          } argument(s)`,
        );
        const ref = {
          namespace: namespace ?? options.defaultNamespace,
          workflowId: workflowId ?? 'dry-run',
          runId: 'dry-run',
        };
        for (const [k, v] of Object.entries(ref)) ctx.output(k as any, v);
        ctx.output('workflowUrl', workflowUrl(options.appBaseUrl, ref));
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      // Without a workflow ID, one from the task and the step: a retry that
      // runs again after the start (before the checkpoint was kept) is
      // refused by Temporal instead of starting a second workflow.
      const id =
        workflowId ??
        `${workflowType ?? parseEntityRef(entityRef!).name}-${ctx.task.id}${
          ctx.step?.id ? `-${ctx.step.id}` : ''
        }`;
      // A retried task does not start the workflow again.
      const started = await ctx.checkpoint({
        key: `temporal.start.${ctx.step?.id ?? 'start'}`,
        fn: async () => {
          const response = await options.client.start(
            {
              entityRef,
              workflowType,
              taskQueue,
              namespace: entityRef ? undefined : namespace,
              workflowId: id,
              args,
            },
            credentials,
          );
          return { ...response };
        },
      });
      ctx.logger.info(
        `Started ${started.workflowId} (run ${started.runId}) in ${started.namespace}`,
      );
      ctx.output('namespace', started.namespace);
      ctx.output('workflowId', started.workflowId);
      ctx.output('runId', started.runId);
      ctx.output('workflowUrl', workflowUrl(options.appBaseUrl, started));
    },
  });
}

/**
 * `temporal:workflow:wait`: waits until a workflow closes, or until a Bool
 * search attribute of it is true (for example `ApprovalPending`).
 */
export function createTemporalWorkflowWaitAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:wait',
    description:
      'Waits until a Temporal workflow closes, or until a Bool search attribute of it is true (for example ApprovalPending, to stop once the workflow waits for someone). Reads the workflow as the user who runs the template.',
    schema: {
      input: {
        ...workflowInput,
        untilSearchAttribute: z =>
          z
            .string()
            .optional()
            .describe(
              'Stop when this Bool search attribute is true, instead of when the workflow closes',
            ),
        timeoutSeconds: z =>
          z
            .number()
            .int()
            .positive()
            .max(3600)
            .optional()
            .describe(
              'How long to wait, at most 3600 seconds (the token of the user who runs the template expires); 600 seconds by default',
            ),
        intervalSeconds: z =>
          z
            .number()
            .int()
            .min(1)
            .max(300)
            .optional()
            .describe(
              'The pause before the second look, 5 seconds by default. The pause doubles after each look, up to maxIntervalSeconds',
            ),
        maxIntervalSeconds: z =>
          z
            .number()
            .int()
            .min(1)
            .max(300)
            .optional()
            .describe(
              'The longest pause between two looks; 30 seconds by default. Set it equal to intervalSeconds to look at a fixed interval. A larger intervalSeconds wins: the pauses never get shorter than it',
            ),
        failIfNotCompleted: z =>
          z
            .boolean()
            .optional()
            .describe(
              'Fail the step when the workflow closes other than Completed; true by default',
            ),
        includeResult: z =>
          z
            .boolean()
            .optional()
            .describe(
              'Output the workflow result; needs the history permission. False by default',
            ),
      },
      output: {
        status: z => z.string(),
        runId: z => z.string(),
        result: z => z.any().optional(),
        searchAttributes: z => z.record(z.any()).optional(),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      if (ctx.isDryRun) {
        ctx.output('status', 'Completed');
        ctx.output('runId', input.runId ?? 'dry-run');
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      let ref: WorkflowRef = {
        namespace: await resolveNamespace(options, input, credentials),
        workflowId: input.workflowId,
        ...(input.runId ? { runId: input.runId } : {}),
      };
      const timeoutMs = (input.timeoutSeconds ?? 600) * 1000;
      // Whole milliseconds: the pause doubles up to the cap. An
      // intervalSeconds above the cap is a fixed interval.
      const firstPauseMs = (input.intervalSeconds ?? 5) * 1000;
      const maxPauseMs = Math.max(
        firstPauseMs,
        (input.maxIntervalSeconds ?? 30) * 1000,
      );
      let pauseMs = firstPauseMs;
      if (
        input.maxIntervalSeconds !== undefined &&
        input.maxIntervalSeconds < (input.intervalSeconds ?? 5)
      ) {
        ctx.logger.warn(
          `maxIntervalSeconds (${
            input.maxIntervalSeconds
          }) is smaller than intervalSeconds (${
            input.intervalSeconds ?? 5
          }); looking every ${input.intervalSeconds ?? 5} seconds`,
        );
      }
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const workflow = await options.client.describe(
          ref,
          input.entityRef,
          credentials,
        );
        const attribute = input.untilSearchAttribute
          ? workflow.searchAttributes?.[input.untilSearchAttribute]
          : undefined;
        if (workflow.status === 'ContinuedAsNew' && ref.runId) {
          // The run continued as new: follow the latest run.
          ref = { namespace: ref.namespace, workflowId: ref.workflowId };
          continue;
        }
        const closed = workflow.status !== 'Running';
        if (attribute === true || closed) {
          ctx.output('status', workflow.status);
          ctx.output('runId', workflow.runId);
          if (workflow.searchAttributes) {
            ctx.output('searchAttributes', workflow.searchAttributes);
          }
          if (attribute === true) {
            ctx.logger.info(
              `${input.workflowId}: ${input.untilSearchAttribute} is true`,
            );
            return;
          }
          if (
            input.failIfNotCompleted !== false &&
            workflow.status !== 'Completed'
          ) {
            throw new Error(
              `Workflow ${input.workflowId} closed as ${workflow.status}`,
            );
          }
          if (input.includeResult) {
            const steps = await options.client.steps(
              { ...ref, runId: workflow.runId },
              input.entityRef,
              credentials,
            );
            if (steps.result !== undefined) ctx.output('result', steps.result);
          }
          ctx.logger.info(`${input.workflowId} closed as ${workflow.status}`);
          return;
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          throw new Error(
            `Workflow ${input.workflowId} is still running after ${
              timeoutMs / 1000
            } seconds`,
          );
        }
        // The last look is at the deadline.
        await sleep(Math.min(pauseMs, left), ctx.signal);
        pauseMs = Math.min(pauseMs * 2, maxPauseMs);
      }
    },
  });
}

/**
 * `temporal:workflow:signal`: sends a signal or an update to a running
 * workflow.
 */
export function createTemporalWorkflowSignalAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:signal',
    description:
      'Sends a signal, or an update and outputs its result, to a running Temporal workflow, as the user who runs the template (temporal.workflow.signal or temporal.workflow.update).',
    schema: {
      input: {
        ...workflowInput,
        kind: z =>
          z
            .enum(['signal', 'update'])
            .optional()
            .describe('signal (default) or update'),
        name: z => z.string().min(1).max(200).describe('Signal or update name'),
        args: z =>
          z
            .any()
            .optional()
            .describe(
              'Arguments: an array is the argument list, any other value the only argument',
            ),
      },
      output: {
        result: z => z.any().optional().describe('The result of an update'),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      const kind = input.kind ?? 'signal';
      const args = exampleArgs(input.args as JsonValue | undefined);
      if (ctx.isDryRun) {
        ctx.logger.info(`Dry run: would send the ${kind} ${input.name}`);
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      // A retried task does not send it again, nor read the entity again;
      // the result is kept.
      const result = await ctx.checkpoint<JsonValue>({
        key: `temporal.${kind}.${ctx.step?.id ?? input.name}`,
        fn: async () => {
          const ref: WorkflowRef = {
            namespace: await resolveNamespace(options, input, credentials),
            workflowId: input.workflowId,
            ...(input.runId ? { runId: input.runId } : {}),
          };
          const response = await options.client.send(
            kind,
            ref,
            { name: input.name, args },
            input.entityRef,
            credentials,
          );
          return response?.result ?? null;
        },
      });
      ctx.logger.info(`Sent the ${kind} ${input.name} to ${input.workflowId}`);
      if (kind === 'update' && result !== null) ctx.output('result', result);
    },
  });
}
