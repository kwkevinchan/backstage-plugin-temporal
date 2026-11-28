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

import { ReactElement, ReactNode, useEffect, useState } from 'react';
import { usePermission } from '@backstage/plugin-permission-react';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import { Button, Flex, Link, Text } from '@backstage/ui';
import { exampleArgs, type WorkflowMessageDefinition } from '../../common';
import type { TemporalWorkflowExtensionProps } from '../../extensions';
import { ErrorAlert } from '../feedback';
import { tp } from '../styles';

/**
 * Whether the user may use a control permission on the entity (and on
 * `additionalResourceRef`, when different). Without an entity (a workflow
 * from the Temporal page that is not linked to one) the frontend cannot
 * ask, so the control is enabled and the backend decides.
 */
export function useControlPermission(
  permission: ResourcePermission<'catalog-entity'>,
  resourceRef: string | undefined,
  additionalResourceRef?: string,
): { allowed: boolean; loading: boolean } {
  const secondRef =
    additionalResourceRef && additionalResourceRef !== resourceRef
      ? additionalResourceRef
      : undefined;
  const first = usePermission({ permission, resourceRef });
  const second = usePermission({ permission, resourceRef: secondRef });
  if (!resourceRef && !secondRef) return { allowed: true, loading: false };
  const firstAllowed = resourceRef ? first.allowed : true;
  const firstLoading = resourceRef ? first.loading : false;
  const secondAllowed = secondRef ? second.allowed : true;
  const secondLoading = secondRef ? second.loading : false;
  return {
    allowed: firstAllowed && secondAllowed,
    loading: firstLoading || secondLoading,
  };
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
    return { args: exampleArgs(value) };
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
}

/** A JSON text area with a label, for message and workflow arguments. */
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

/**
 * A button for an operation that needs a permission. It is disabled, with
 * the reason as a tooltip, when the user does not have `permission` on the
 * entity `resourceRef` (or `additionalResourceRef`, when set). The reason
 * reads "You do not have permission to `action` `noun`".
 */
export function PermissionButton(props: {
  label: string;
  permission: ResourcePermission<'catalog-entity'>;
  resourceRef?: string;
  additionalResourceRef?: string;
  onPress(): void;
  /** What the button does, in the reason. Defaults to the label in lower case. */
  action?: string;
  /** What the button acts on, in the reason. Defaults to "this workflow". */
  noun?: string;
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium';
  iconStart?: ReactElement;
  isPending?: boolean;
  destructive?: boolean;
}) {
  const { allowed, loading } = useControlPermission(
    props.permission,
    props.resourceRef,
    props.additionalResourceRef,
  );
  const action =
    props.action ?? props.label.replace(/…$/, '').toLocaleLowerCase('en-US');
  const reason =
    !allowed && !loading
      ? `You do not have permission to ${action} ${
          props.noun ?? 'this workflow'
        } (${props.permission.name})`
      : undefined;
  return (
    <WithReason reason={reason}>
      <Button
        variant={props.variant ?? 'secondary'}
        size={props.size}
        iconStart={props.iconStart}
        destructive={props.destructive}
        isPending={props.isPending}
        isDisabled={!allowed}
        onPress={props.onPress}
      >
        {props.label}
      </Button>
    </WithReason>
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
  let result: ControlError;
  if (typeof message === 'string' && message) result = new Error(message);
  else result = error instanceof Error ? error : new Error(String(error));
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
  /**
   * Show the "Open the run it continued as" link when the conflict carries
   * `continuedAsNewRunId` (only signals lock to one run).
   */
  showContinuedAsNew?: boolean;
}) {
  const { error, context } = props;
  const reload = context?.reload;
  useEffect(() => {
    if (error.statusCode === 404) reload?.();
  }, [error, reload]);
  const next = props.showContinuedAsNew ? error.continuedAsNewRunId : undefined;
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

/**
 * The example arguments of a message definition, with its `userField` set to the
 * signed-in user on an object argument.
 */
export function messageDefinitionExampleArgs(
  definition: WorkflowMessageDefinition | undefined,
  userEntityRef: string | undefined,
): JsonValue[] {
  const args = exampleArgs(definition?.example);
  const field = definition?.userField;
  if (!field || !userEntityRef) return args;
  const first = args[0];
  const base =
    first && typeof first === 'object' && !Array.isArray(first) ? first : {};
  return [{ ...base, [field]: userEntityRef }, ...args.slice(1)];
}

/** Props of the arguments field of a {@link MessageDialog}. */
export interface MessageArgsFieldProps {
  /** The chosen message definition, when the workflow or its entity describes it. */
  messageDefinition?: WorkflowMessageDefinition;
  /** The signed-in user's entity reference, for `messageDefinition.userField`. */
  userEntityRef?: string;
  /** Called with the arguments, or why they are not valid. */
  onChange(value: { args: JsonValue[] } | { error: string }): void;
}

function argsText(args: JsonValue[]): string {
  if (args.length === 0) return '[]';
  // One object or array argument is shown as itself; parseArgs reads an
  // array as the argument list, so only a non-array value can be bare.
  const value = args.length === 1 && !Array.isArray(args[0]) ? args[0] : args;
  return JSON.stringify(value, null, 2);
}

/**
 * The default arguments field: JSON, filled with the message definition's example.
 */
export function JsonMessageArgsField(props: MessageArgsFieldProps) {
  const { messageDefinition, userEntityRef, onChange } = props;
  const [text, setText] = useState(() =>
    argsText(messageDefinitionExampleArgs(messageDefinition, userEntityRef)),
  );
  const [edited, setEdited] = useState(false);
  // The user's reference may come after the field opens.
  useEffect(() => {
    if (!edited)
      setText(
        argsText(
          messageDefinitionExampleArgs(messageDefinition, userEntityRef),
        ),
      );
  }, [edited, messageDefinition, userEntityRef]);
  useEffect(() => {
    onChange(parseArgs(text));
  }, [text, onChange]);
  return (
    <JsonArgsField
      value={text}
      onChange={value => {
        setEdited(true);
        setText(value);
      }}
    />
  );
}
