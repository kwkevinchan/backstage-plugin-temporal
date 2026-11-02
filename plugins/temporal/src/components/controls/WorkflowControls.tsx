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
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import type { ResourcePermission } from '@backstage/plugin-permission-common';
import type { JsonValue } from '@backstage/types';
import {
  temporalWorkflowCancelPermission,
  temporalWorkflowRerunPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowUpdatePermission,
  WorkflowDetail,
  WorkflowRef,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import {
  TemporalApi,
  temporalApiRef,
} from '@kwkevinchan/backstage-plugin-temporal-react';
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
  TextField,
} from '@backstage/ui';
import { ErrorAlert } from '../feedback';
import { JsonView } from '../PayloadView';
import { tp } from '../styles';
import {
  controlError,
  JsonArgsField,
  parseArgs,
  useControlConfig,
  useControlPermission,
  WithReason,
} from './shared';

/** Query of the Temporal SDKs that lists a workflow's handlers. */
const METADATA_QUERY = '__temporal_workflow_metadata';

type MessageKind = 'signal' | 'update' | 'query';
type Open = MessageKind | 'cancel' | 'terminate' | 'rerun' | undefined;

interface HandlerNames {
  signal: string[];
  update: string[];
  query: string[];
}

function names(definitions: unknown): string[] {
  if (!Array.isArray(definitions)) return [];
  return definitions
    .map(d => (d as { name?: unknown })?.name)
    .filter((n): n is string => typeof n === 'string' && !n.startsWith('__'));
}

/**
 * The signal, update and query names a workflow defines, from the metadata
 * query of the Temporal SDKs. Empty when the worker does not answer it.
 */
function useHandlerNames(
  api: TemporalApi,
  ref: WorkflowRef,
  entityRef: string | undefined,
  enabled: boolean,
): HandlerNames | undefined {
  const [value, setValue] = useState<HandlerNames>();
  const { namespace, workflowId, runId } = ref;
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    api
      .queryWorkflow(
        { namespace, workflowId, runId },
        { name: METADATA_QUERY },
        { entityRef },
      )
      .then(({ result }) => {
        const definition = (result as any)?.definition ?? {};
        if (current) {
          setValue({
            signal: names(definition.signalDefinitions),
            update: names(definition.updateDefinitions),
            query: names(definition.queryDefinitions),
          });
        }
      })
      .catch(() => {
        if (current) setValue({ signal: [], update: [], query: [] });
      });
    return () => {
      current = false;
    };
  }, [api, namespace, workflowId, runId, entityRef, enabled]);
  return value;
}

const MESSAGE_TEXT: Record<
  MessageKind,
  {
    title: string;
    label: string;
    done: string;
    doneSuffix: string;
    submit: string;
    help: string;
  }
> = {
  signal: {
    label: 'Signal name',
    done: 'Signal',
    doneSuffix: ' sent',
    title: 'Send a signal',
    submit: 'Send signal',
    help: 'The workflow gets the signal the next time it runs; there is no result.',
  },
  update: {
    label: 'Update name',
    done: 'Update',
    doneSuffix: ' done',
    title: 'Send an update',
    submit: 'Send update',
    help: 'The workflow handles the update and returns a result, or rejects it.',
  },
  query: {
    label: 'Query name',
    done: 'Query',
    doneSuffix: ' answered',
    title: 'Query the workflow',
    submit: 'Run query',
    help: 'A query reads the state of the workflow without changing it.',
  },
};

/** Signal, update or query: a name, JSON arguments, then the result. */
function MessageDialog(props: {
  kind: MessageKind;
  workflow: WorkflowDetail;
  entityRef?: string;
  options: string[];
  allowsCustomValue: boolean;
  onClose(): void;
  onSent(): void;
}) {
  const { kind, workflow, entityRef } = props;
  const api = useApi(temporalApiRef);
  const text = MESSAGE_TEXT[kind];
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
  const ref = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };

  const submit = async () => {
    if (!name.trim() || 'error' in parsed) return;
    setPending(true);
    setError(undefined);
    setDone(undefined);
    const request = { name: name.trim(), args: parsed.args };
    try {
      if (kind === 'signal') {
        await api.signalWorkflow(ref, request, { entityRef });
        setDone({});
      } else if (kind === 'update') {
        setDone(await api.updateWorkflow(ref, request, { entityRef }));
      } else {
        setDone(await api.queryWorkflow(ref, request, { entityRef }));
      }
      if (kind !== 'query') props.onSent();
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
              {kind !== 'signal' && (
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

/** Asks before cancel, terminate (with a reason) or rerun. */
function ConfirmDialog(props: {
  title: string;
  description: string;
  confirm: string;
  /** Label of the button that closes the dialog. */
  dismiss: string;
  destructive?: boolean;
  /** Ask for a reason, required. */
  reason?: boolean;
  onConfirm(reason: string): Promise<void>;
  onClose(): void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const confirm = async () => {
    setPending(true);
    setError(undefined);
    try {
      await props.onConfirm(reason.trim());
      props.onClose();
    } catch (e) {
      setError(controlError(e));
      setPending(false);
    }
  };
  return (
    <Dialog isOpen onOpenChange={open => !open && props.onClose()} width={480}>
      <DialogHeader>{props.title}</DialogHeader>
      <DialogBody>
        <Flex direction="column" gap="3">
          <Text variant="body-medium">{props.description}</Text>
          {props.reason && (
            <TextField
              label="Reason"
              value={reason}
              onChange={setReason}
              isRequired
            />
          )}
          {error && <ErrorAlert error={error} />}
        </Flex>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" slot="close">
          {props.dismiss}
        </Button>
        <Button
          variant="primary"
          destructive={props.destructive}
          isPending={pending}
          isDisabled={props.reason && !reason.trim()}
          onPress={confirm}
        >
          {props.confirm}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ControlButton(props: {
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

/**
 * The operations on a workflow in the action bar of the details page:
 * signal, update, query, cancel and terminate while it runs; rerun and
 * query once it is closed. Each button is disabled when the user does not
 * have its permission on the workflow's entity.
 */
export function WorkflowControls(props: {
  workflow: WorkflowDetail;
  entityRef?: string;
  reload(): void;
  workflowHref(ref: WorkflowRef): string;
}) {
  const { workflow, entityRef, reload } = props;
  const api = useApi(temporalApiRef);
  const navigate = useNavigate();
  const config = useControlConfig();
  const [open, setOpen] = useState<Open>();
  const running = workflow.status === 'Running';
  const resourceRef = entityRef ?? workflow.entityRef;
  const ref = {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
  const handlers = useHandlerNames(
    api,
    ref,
    entityRef,
    open === 'signal' || open === 'update' || open === 'query',
  );
  const close = () => setOpen(undefined);

  const messageOptions = (kind: MessageKind): [string[], boolean] => {
    const allowedByKind: Record<MessageKind, string[]> = {
      signal: config.allowedSignals,
      update: config.allowedUpdates,
      query: [],
    };
    const allowed = allowedByKind[kind];
    if (allowed.length > 0) return [allowed, false];
    return [handlers?.[kind] ?? [], true];
  };

  return (
    <>
      {config.enabled && running && (
        <>
          <ControlButton
            label="Signal…"
            permission={temporalWorkflowSignalPermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('signal')}
          />
          <ControlButton
            label="Update…"
            permission={temporalWorkflowUpdatePermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('update')}
          />
        </>
      )}
      <Button variant="secondary" onPress={() => setOpen('query')}>
        Query…
      </Button>
      {config.enabled && running && (
        <>
          <ControlButton
            label="Cancel"
            permission={temporalWorkflowCancelPermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('cancel')}
          />
          <ControlButton
            label="Terminate"
            destructive
            permission={temporalWorkflowTerminatePermission}
            resourceRef={resourceRef}
            onPress={() => setOpen('terminate')}
          />
        </>
      )}
      {config.enabled && !running && (
        <ControlButton
          label="Rerun"
          permission={temporalWorkflowRerunPermission}
          resourceRef={resourceRef}
          onPress={() => setOpen('rerun')}
        />
      )}

      {(open === 'signal' || open === 'update' || open === 'query') && (
        <MessageDialog
          key={open}
          kind={open}
          workflow={workflow}
          entityRef={entityRef}
          options={messageOptions(open)[0]}
          allowsCustomValue={messageOptions(open)[1]}
          onClose={close}
          onSent={reload}
        />
      )}
      {open === 'cancel' && (
        <ConfirmDialog
          title="Cancel this workflow?"
          description="The workflow is asked to cancel. It can clean up before it closes, or ignore the request."
          confirm="Cancel workflow"
          dismiss="Keep running"
          onClose={close}
          onConfirm={async () => {
            await api.cancelWorkflow(ref, { entityRef });
            reload();
          }}
        />
      )}
      {open === 'terminate' && (
        <ConfirmDialog
          title="Terminate this workflow?"
          description="The workflow stops at once, without running any more code. The reason is kept in its history."
          confirm="Terminate"
          dismiss="Keep running"
          destructive
          reason
          onClose={close}
          onConfirm={async reason => {
            await api.terminateWorkflow(ref, { reason }, { entityRef });
            reload();
          }}
        />
      )}
      {open === 'rerun' && (
        <ConfirmDialog
          title="Run this workflow again?"
          description="A new workflow starts with the input, type, task queue and search attributes of this run, under a new workflow ID. This run stays as it is."
          confirm="Rerun"
          dismiss="Close"
          onClose={close}
          onConfirm={async () => {
            const started = await api.rerunWorkflow(ref, {}, { entityRef });
            navigate(props.workflowHref(started));
          }}
        />
      )}
    </>
  );
}
