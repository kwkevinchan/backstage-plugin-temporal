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

import { ReactNode, useEffect, useState } from 'react';
import { usePermission } from '@backstage/plugin-permission-react';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import { Flex, Link, Text } from '@backstage/ui';
import type { TemporalWorkflowExtensionProps } from '../../extensions';
import { ErrorAlert } from '../feedback';
import { tp } from '../styles';

/**
 * Whether the user may use a control permission on the entity. Without an
 * entity (a workflow from the Workflows page that is not linked to one) the
 * frontend cannot ask, so the control is enabled and the backend decides.
 */
export function useControlPermission(
  permission: ResourcePermission<'catalog-entity'>,
  resourceRef: string | undefined,
): { allowed: boolean; loading: boolean } {
  const result = usePermission({ permission, resourceRef });
  if (!resourceRef) return { allowed: true, loading: false };
  return { allowed: result.allowed, loading: result.loading };
}

/**
 * Parses the arguments field: a JSON array is the argument list, any other
 * JSON value the only argument, an empty field no arguments.
 */
export function parseArgs(
  text: string,
): { args: JsonValue[] } | { error: string } {
  if (!text.trim()) return { args: [] };
  try {
    const value = JSON.parse(text) as JsonValue;
    return { args: Array.isArray(value) ? value : [value] };
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
}

/** A JSON text area with a label, for handler and workflow arguments. */
export function JsonArgsField(props: {
  value: string;
  onChange(value: string): void;
  label?: string;
  description?: string;
}) {
  const [id] = useState(
    () => `tp-args-${Math.random().toString(36).slice(2, 8)}`,
  );
  const parsed = parseArgs(props.value);
  const error = 'error' in parsed ? parsed.error : undefined;
  return (
    <div className={tp('tp-field')}>
      <label htmlFor={id} className={tp('tp-field-label')}>
        {props.label ?? 'Arguments (JSON)'}
      </label>
      <textarea
        id={id}
        className={tp('tp-json-input')}
        value={props.value}
        spellCheck={false}
        rows={6}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
        onChange={e => props.onChange(e.target.value)}
      />
      <Text
        as="p"
        id={`${id}-help`}
        variant="body-x-small"
        color={error ? 'danger' : 'secondary'}
      >
        {error ??
          props.description ??
          'A JSON array is the list of arguments; any other value is the only argument.'}
      </Text>
    </div>
  );
}

/**
 * A control that is disabled with a reason: the reason shows as a tooltip
 * on hover.
 */
export function WithReason(props: { reason?: string; children: ReactNode }) {
  if (!props.reason) return <>{props.children}</>;
  return (
    <span className={tp('tp-disabled-control')} title={props.reason}>
      {props.children}
    </span>
  );
}

/** The error of a failed operation, as {@link controlError} gives it. */
export type ControlError = Error & {
  /** The HTTP status of the answer, when there was one. */
  statusCode?: number;
  /** For a run that continued as new: the run it continued as. */
  continuedAsNewRunId?: string;
};

/**
 * The error to show for a failed operation: the backend's message (for
 * example the message of an update validator) rather than the HTTP status,
 * with the status and the run a refused run continued as.
 */
export function controlError(error: unknown): ControlError {
  const body = (
    error as {
      body?: { error?: { message?: unknown; continuedAsNewRunId?: unknown } };
    }
  )?.body?.error;
  const message = body?.message;
  const result: ControlError =
    typeof message === 'string' && message
      ? new Error(message)
      : error instanceof Error
      ? error
      : new Error(String(error));
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  if (typeof statusCode === 'number') result.statusCode = statusCode;
  if (
    typeof body?.continuedAsNewRunId === 'string' &&
    body.continuedAsNewRunId
  ) {
    result.continuedAsNewRunId = body.continuedAsNewRunId;
  }
  return result;
}

/**
 * The error of an operation on the run of the details page. For a run that
 * continued as new, a link to the run it continued as. A run that is not
 * found (it may have closed or continued as new meanwhile) reloads the
 * page.
 */
export function ControlErrorAlert(props: {
  error: ControlError;
  /** The details page the operation ran from. */
  context?: Pick<
    TemporalWorkflowExtensionProps,
    'workflow' | 'workflowHref' | 'reload'
  >;
}) {
  const { error, context } = props;
  const reload = context?.reload;
  useEffect(() => {
    if (error.statusCode === 404) reload?.();
  }, [error, reload]);
  const next = error.continuedAsNewRunId;
  return (
    <Flex direction="column" gap="2">
      <ErrorAlert error={error} />
      {next && context && (
        <Text variant="body-small" data-testid="operation-continued-as-new">
          This run continued as new.{' '}
          <Link
            href={context.workflowHref({
              namespace: context.workflow.namespace,
              workflowId: context.workflow.workflowId,
              runId: next,
            })}
            variant="body-small"
          >
            Open the run it continued as
          </Link>
        </Text>
      )}
    </Flex>
  );
}
