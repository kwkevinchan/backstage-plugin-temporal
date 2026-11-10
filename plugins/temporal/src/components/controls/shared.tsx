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

import { ReactNode, useState } from 'react';
import { usePermission } from '@backstage/plugin-permission-react';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import { Text } from '@backstage/ui';
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

/**
 * The error to show for a failed operation: the backend's message (for
 * example the message of an update validator) rather than the HTTP status.
 */
export function controlError(error: unknown): Error {
  const message = (error as { body?: { error?: { message?: unknown } } })?.body
    ?.error?.message;
  if (typeof message === 'string' && message) return new Error(message);
  return error instanceof Error ? error : new Error(String(error));
}
