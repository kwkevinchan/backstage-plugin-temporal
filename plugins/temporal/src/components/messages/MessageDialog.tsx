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

import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import type {
  WorkflowDetail,
  WorkflowHandlersResponse,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  Alert,
  Button,
  Combobox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Flex,
  Text,
} from '@backstage/ui';
import { temporalApiRef } from '../../extensions';
import { ErrorAlert } from '../feedback';
import { JsonView } from '../PayloadView';
import { tp } from '../styles';
import {
  controlError,
  JsonArgsField,
  parseArgs,
  useControlPermission,
  WithReason,
} from './shared';

const NO_HANDLERS: WorkflowHandlersResponse = {
  signals: [],
  updates: [],
  queries: [],
};

/**
 * The signals, updates and queries a workflow defines
 * (`GET .../handlers`). Undefined while loading or when `enabled` is
 * false; empty when the backend cannot tell.
 */
export function useWorkflowHandlers(
  ref: WorkflowRef,
  entityRef: string | undefined,
  enabled: boolean,
): WorkflowHandlersResponse | undefined {
  const api = useApi(temporalApiRef);
  const [value, setValue] = useState<WorkflowHandlersResponse>();
  const { namespace, workflowId, runId } = ref;
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    api
      .getWorkflowHandlers({ namespace, workflowId, runId }, { entityRef })
      .then(handlers => current && setValue(handlers))
      .catch(() => current && setValue(NO_HANDLERS));
    return () => {
      current = false;
    };
  }, [api, namespace, workflowId, runId, entityRef, enabled]);
  return value;
}

/** Texts of a {@link MessageDialog}. */
export interface MessageDialogText {
  title: string;
  /** Label of the name field. */
  label: string;
  /** Title of the success message; the name is added after it. */
  done: string;
  /** Added after the name in the success message. */
  doneSuffix: string;
  submit: string;
  help: string;
}

/**
 * Signal, update or query: a name, JSON arguments, then the result.
 * `send` sends the message; the dialog shows its result unless
 * `showResult` is false.
 */
export function MessageDialog(props: {
  /** `signal`, `update` or `query`; names the result's test ID. */
  kind: string;
  text: MessageDialogText;
  options: string[];
  allowsCustomValue: boolean;
  showResult?: boolean;
  send(request: {
    name: string;
    args: JsonValue[];
  }): Promise<{ result?: JsonValue }>;
  onClose(): void;
}) {
  const { kind, text } = props;
  const [name, setName] = useState(props.options[0] ?? '');
  // The handler names may come after the dialog opens.
  const firstOption = props.options[0];
  useEffect(() => {
    if (firstOption) setName(current => current || firstOption);
  }, [firstOption]);
  const [args, setArgs] = useState('[]');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [done, setDone] = useState<{ result?: JsonValue }>();
  const parsed = parseArgs(args);

  const submit = async () => {
    if (!name.trim() || 'error' in parsed) return;
    setPending(true);
    setError(undefined);
    setDone(undefined);
    try {
      setDone(await props.send({ name: name.trim(), args: parsed.args }));
    } catch (e) {
      setError(controlError(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog isOpen onOpenChange={open => !open && props.onClose()} width={560}>
      <DialogHeader>{text.title}</DialogHeader>
      <DialogBody>
        <Flex direction="column" gap="3">
          <Text variant="body-small" color="secondary">
            {text.help}
          </Text>
          <Combobox
            label={text.label}
            options={props.options.map(o => ({ value: o, label: o }))}
            allowsCustomValue={props.allowsCustomValue}
            inputValue={name}
            onInputChange={setName}
            onSelectionChange={key => key !== null && setName(String(key))}
            isRequired
          />
          <JsonArgsField value={args} onChange={setArgs} />
          {error && <ErrorAlert error={error} />}
          {done && (
            <div data-testid={`workflow-${kind}-result`}>
              <Alert
                status="success"
                icon
                title={`${text.done} ${name}${text.doneSuffix}`}
              />
              {props.showResult !== false && (
                <div className={tp('tp-dialog-result')}>
                  <Text as="h4" variant="title-x-small">
                    Result
                  </Text>
                  {done.result === undefined ? (
                    <Text variant="body-small" color="secondary">
                      No result
                    </Text>
                  ) : (
                    <JsonView value={done.result} open />
                  )}
                </div>
              )}
            </div>
          )}
        </Flex>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" slot="close">
          Close
        </Button>
        <Button
          variant="primary"
          isPending={pending}
          isDisabled={!name.trim() || 'error' in parsed}
          onPress={submit}
        >
          {text.submit}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * A secondary button for an operation on a workflow. It is disabled, with
 * the reason as a tooltip, when the user does not have `permission` on the
 * entity `resourceRef`.
 */
export function PermissionButton(props: {
  label: string;
  permission: ResourcePermission<'catalog-entity'>;
  resourceRef?: string;
  onPress(): void;
  destructive?: boolean;
}) {
  const { allowed, loading } = useControlPermission(
    props.permission,
    props.resourceRef,
  );
  const reason =
    !allowed && !loading
      ? `You do not have permission to ${props.label
          .replace(/…$/, '')
          .toLocaleLowerCase('en-US')} this workflow (${props.permission.name})`
      : undefined;
  return (
    <WithReason reason={reason}>
      <Button
        variant="secondary"
        destructive={props.destructive}
        isDisabled={!allowed}
        onPress={props.onPress}
      >
        {props.label}
      </Button>
    </WithReason>
  );
}

/** Reference of a workflow run, from its details. */
export function refOf(workflow: WorkflowDetail): WorkflowRef {
  return {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
}
