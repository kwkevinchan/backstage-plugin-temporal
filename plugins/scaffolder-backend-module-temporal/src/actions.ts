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
} from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
  ResponseError,
} from '@backstage/errors';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import type { JsonValue } from '@backstage/types';
import {
  exampleArgs,
  WorkflowMessageResponse,
  type WorkflowStatus,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import {
  buildWorkflowUrl,
  continuedAsNewRunIdOf,
  resolveWorkflowNamespace,
  TemporalPluginClient,
  type WorkflowNamespaceOptions,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';

export interface TemporalActionsOptions extends WorkflowNamespaceOptions {
  client: TemporalPluginClient;
  auth: AuthService;
  /**
   * Lets a task that does not run as a user (for example one started with a
   * static token from `backend.auth.externalAccess`) start workflows and send
   * signals and updates. Defaults to false
   * (`temporal.scaffolder.allowServiceWrites`).
   */
  allowServiceWrites?: boolean;
  /** `app.baseUrl`, for the link to the workflow. */
  appBaseUrl: string;
  /** The path of the Temporal page (`temporal.pagePath`), for the link. */
  pagePath?: string;
}

/**
 * Refuses a workflow-changing action when the task does not run as a user.
 * The permission framework allows a service principal that has no access
 * restrictions without asking the policy, so per-user permissions would not
 * apply to it.
 */
function assertMayWrite(
  options: TemporalActionsOptions,
  credentials: BackstageCredentials,
  actionId: string,
): void {
  if (
    !options.allowServiceWrites &&
    !options.auth.isPrincipal(credentials, 'user')
  ) {
    throw new NotAllowedError(
      `${actionId} needs a task that runs as a signed-in user, so that per-user permissions apply. Set temporal.scaffolder.allowServiceWrites: true to allow other callers.`,
    );
  }
}

/** The longest pause between two looks of wait. */
const MAX_PAUSE_SECONDS = 30;

/** Statuses of a run that has ended for good; ContinuedAsNew is followed. */
const CLOSED_STATUSES = new Set<WorkflowStatus>([
  'Completed',
  'Failed',
  'Canceled',
  'Terminated',
  'TimedOut',
]);

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
    z
      .string()
      .optional()
      .describe(
        'Run ID; when left out, the action looks up the latest run in the run list of the workflow ID',
      ),
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
        'Entity the workflow belongs to, whose permissions are checked; else the entity in its search attribute, or the list permission',
      ),
};

/**
 * `temporal:workflow:start`: starts a workflow as the user who runs the
 * template. A task that does not run as a user is refused unless
 * `temporal.scaffolder.allowServiceWrites` is true.
 */
export function createTemporalWorkflowStartAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:start',
    description:
      'Starts a Temporal workflow: the workflow of an entity (a TemporalWorkflow entity, or one with the Temporal annotations), or any workflow type with its task queue. Checked with temporal.workflow.start as the user who runs the template; a task that does not run as a user is refused by default.',
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
              'Workflow ID; when left out, one is made from the workflow/entity, task ID, and step ID and started with REJECT_DUPLICATE so it cannot run more than once',
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
      const explicitId = workflowId?.trim() || undefined;
      const usingDefaultId = !explicitId;
      if (ctx.isDryRun) {
        ctx.logger.info(
          `Dry run: would start ${workflowType ?? entityRef} with ${
            args.length
          } argument(s)`,
        );
        const ref = {
          namespace: namespace ?? options.defaultNamespace,
          workflowId: explicitId ?? 'dry-run',
          runId: 'dry-run',
        };
        for (const [k, v] of Object.entries(ref)) ctx.output(k as any, v);
        ctx.output(
          'workflowUrl',
          buildWorkflowUrl(options.appBaseUrl, ref, {
            pagePath: options.pagePath,
          }),
        );
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      assertMayWrite(options, credentials, 'temporal:workflow:start');
      // Without a workflow ID, build one from the task and the step and send
      // REJECT_DUPLICATE: a retry that runs again after the start (even if
      // that first workflow has already closed) is refused by Temporal instead
      // of starting a second workflow.
      const id =
        explicitId ??
        `${workflowType ?? parseEntityRef(entityRef!).name}-${ctx.task.id}${
          ctx.step?.id ? `-${ctx.step.id}` : ''
        }`;
      // A retried task does not start the workflow again.
      const started = await ctx.checkpoint({
        key: `temporal.start.${ctx.step?.id ?? 'start'}`,
        fn: async () => {
          try {
            const response = await options.client.start(
              {
                entityRef,
                workflowType,
                taskQueue,
                namespace: entityRef ? undefined : namespace,
                workflowId: id,
                args,
                ...(usingDefaultId
                  ? { workflowIdReusePolicy: 'REJECT_DUPLICATE' as const }
                  : {}),
              },
              credentials,
            );
            return { ...response };
          } catch (error) {
            if (
              usingDefaultId &&
              error instanceof ResponseError &&
              error.response.status === 409
            ) {
              throw new ConflictError(
                `Workflow ID "${id}" has already been run by this task; the default workflow ID cannot be started more than once. Give an explicit workflowId to start another run, or start a new task`,
              );
            }
            throw error;
          }
        },
      });
      ctx.logger.info(
        `Started ${started.workflowId} (run ${started.runId}) in ${started.namespace}`,
      );
      ctx.output('namespace', started.namespace);
      ctx.output('workflowId', started.workflowId);
      ctx.output('runId', started.runId);
      ctx.output(
        'workflowUrl',
        buildWorkflowUrl(options.appBaseUrl, started, {
          pagePath: options.pagePath,
        }),
      );
    },
  });
}

/**
 * `temporal:workflow:wait`: waits until a workflow closes, or until a Bool
 * search attribute of it is true (for example `ApprovalPending`). It only
 * reads, so it accepts any initiator.
 */
export function createTemporalWorkflowWaitAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:wait',
    description:
      'Waits until a Temporal workflow closes, or until a Bool search attribute of it is true (for example ApprovalPending, to stop once the workflow waits for someone). Reads the workflow with the credentials of the task initiator.',
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
              'The pause before the second look, 5 seconds by default. The pause doubles after each look, up to 30 seconds. A larger intervalSeconds is a fixed interval',
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
            .describe('Output the workflow result. False by default'),
      },
      output: {
        status: z =>
          z.string().describe('The status of the run; Unknown in a dry run'),
        runId: z => z.string(),
        result: z => z.any().optional(),
        searchAttributes: z => z.record(z.any()).optional(),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      if (ctx.isDryRun) {
        // Nothing was read, so no real status is known.
        ctx.output('status', 'Unknown');
        ctx.output('runId', input.runId ?? 'dry-run');
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      const base = {
        namespace: await resolveWorkflowNamespace(options, input, credentials),
        workflowId: input.workflowId,
      };
      let runId: string | undefined = input.runId;
      let found = Boolean(runId);
      const timeoutMs = (input.timeoutSeconds ?? 600) * 1000;
      // Whole milliseconds: the pause doubles up to the cap. An
      // intervalSeconds above the cap is a fixed interval.
      const firstPauseMs = (input.intervalSeconds ?? 5) * 1000;
      const maxPauseMs = Math.max(firstPauseMs, MAX_PAUSE_SECONDS * 1000);
      let pauseMs = firstPauseMs;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // Without a run ID, the latest run of the run list; a workflow that
        // has just started may not be listed yet.
        runId ??= await options.client.latestRunId(
          base,
          input.entityRef,
          credentials,
        );
        if (runId) {
          found = true;
          const ref = { ...base, runId };
          const workflow = await options.client.describe(
            ref,
            input.entityRef,
            credentials,
          );
          const attribute = input.untilSearchAttribute
            ? workflow.searchAttributes?.[input.untilSearchAttribute]
            : undefined;
          if (workflow.status === 'ContinuedAsNew') {
            // Follow the run it continued as; else the latest run.
            const next =
              workflow.continuedAsNewRunId ??
              (await options.client.latestRunId(
                base,
                input.entityRef,
                credentials,
              ));
            if (next && next !== runId) {
              runId = next;
              continue;
            }
            // The list does not show the new run yet: look again later.
            runId = undefined;
          } else if (
            attribute === true ||
            CLOSED_STATUSES.has(workflow.status)
          ) {
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
              const outcome = await options.client.result(
                { ...base, runId: workflow.runId },
                input.entityRef,
                credentials,
              );
              if (outcome.result !== undefined) {
                ctx.output('result', outcome.result);
              }
            }
            ctx.logger.info(`${input.workflowId} closed as ${workflow.status}`);
            return;
          }
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          throw new Error(
            found
              ? `Workflow ${input.workflowId} is still running after ${
                  timeoutMs / 1000
                } seconds`
              : `No run of workflow ${input.workflowId} was found in ${
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

/** The workflow chain and run that a signal or an update is sent to. */
async function locateRun(
  options: TemporalActionsOptions,
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
    (await options.client.latestRunId(base, input.entityRef, credentials));
  if (!runId) {
    throw new NotFoundError(
      `No run of workflow ${input.workflowId} was found; give runId, for example the output of temporal:workflow:start`,
    );
  }
  return { base, runId };
}

/**
 * `temporal:workflow:signal`: sends a signal to a running workflow. A task
 * that does not run as a user is refused unless
 * `temporal.scaffolder.allowServiceWrites` is true.
 */
export function createTemporalWorkflowSignalAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:signal',
    description:
      'Sends a signal to a running Temporal workflow, as the user who runs the template (temporal.workflow.signal); a task that does not run as a user is refused by default. To send an update and use its result, use temporal:workflow:update.',
    schema: {
      input: {
        ...workflowInput,
        name: z => z.string().min(1).max(200).describe('Signal name'),
        args: z =>
          z
            .any()
            .optional()
            .describe(
              'Arguments: an array is the argument list, any other value the only argument',
            ),
      },
      output: {
        runId: z => z.string().describe('The run the signal was sent to'),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      const args = exampleArgs(input.args as JsonValue | undefined);
      if (ctx.isDryRun) {
        ctx.logger.info(`Dry run: would send the signal ${input.name}`);
        ctx.output('runId', input.runId ?? 'dry-run');
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      assertMayWrite(options, credentials, 'temporal:workflow:signal');
      // A retried task does not send it again, nor read the entity or the
      // run again.
      const sent = await ctx.checkpoint<{ runId: string }>({
        key: `temporal.signal.${ctx.step?.id ?? input.name}`,
        fn: async () => {
          const { base, runId } = await locateRun(options, input, credentials);
          const send = (id: string) =>
            options.client.send(
              'signal',
              { ...base, runId: id },
              { name: input.name, args },
              input.entityRef,
              credentials,
            );
          try {
            await send(runId);
            return { runId };
          } catch (error) {
            // Signals lock to one run: if the run looked up continued as new
            // since, send once more to the run it continued as. A given run
            // ID is kept.
            const next = input.runId ? undefined : continuedAsNewRunIdOf(error);
            if (!next) throw error;
            await send(next);
            return { runId: next };
          }
        },
      });
      ctx.logger.info(
        `Sent the signal ${input.name} to ${input.workflowId} (run ${sent.runId})`,
      );
      ctx.output('runId', sent.runId);
    },
  });
}

/**
 * `temporal:workflow:update`: sends an update to a running workflow and
 * outputs its result. A task that does not run as a user is refused unless
 * `temporal.scaffolder.allowServiceWrites` is true.
 */
export function createTemporalWorkflowUpdateAction(
  options: TemporalActionsOptions,
) {
  return createTemplateAction({
    id: 'temporal:workflow:update',
    description:
      'Sends an update to a running Temporal workflow and outputs its result, as the user who runs the template (temporal.workflow.update); a task that does not run as a user is refused by default. To send a signal, use temporal:workflow:signal.',
    schema: {
      input: {
        ...workflowInput,
        name: z => z.string().min(1).max(200).describe('Update name'),
        args: z =>
          z
            .any()
            .optional()
            .describe(
              'Arguments: an array is the argument list, any other value the only argument',
            ),
      },
      output: {
        result: z =>
          z
            .any()
            .optional()
            .describe(
              'The result of the update, including a null result; not set when the update returns no result',
            ),
        runId: z =>
          z
            .string()
            .describe(
              'The run used to locate the workflow chain; the update acts on the run of the chain that is currently running',
            ),
      },
    },
    async handler(ctx) {
      const { input } = ctx;
      const args = exampleArgs(input.args as JsonValue | undefined);
      if (ctx.isDryRun) {
        ctx.logger.info(`Dry run: would send the update ${input.name}`);
        ctx.output('runId', input.runId ?? 'dry-run');
        return;
      }
      const credentials = await ctx.getInitiatorCredentials();
      assertMayWrite(options, credentials, 'temporal:workflow:update');
      // A retried task does not send it again, nor read the entity or the
      // run again; the result is kept. `hasResult` tells an update without a
      // result from one whose result is null.
      const sent = await ctx.checkpoint<{
        hasResult: boolean;
        result: JsonValue;
        runId: string;
      }>({
        key: `temporal.update.${ctx.step?.id ?? input.name}`,
        fn: async () => {
          const { base, runId } = await locateRun(options, input, credentials);
          // Updates follow the chain in the backend, so a continued-as-new
          // run needs no second send.
          const response: WorkflowMessageResponse | undefined =
            await options.client.send(
              'update',
              { ...base, runId },
              { name: input.name, args },
              input.entityRef,
              credentials,
            );
          const hasResult = response?.result !== undefined;
          return { hasResult, result: response?.result ?? null, runId };
        },
      });
      ctx.logger.info(
        `Sent the update ${input.name} to ${input.workflowId} (run ${sent.runId})`,
      );
      ctx.output('runId', sent.runId);
      if (sent.hasResult) ctx.output('result', sent.result);
    },
  });
}
