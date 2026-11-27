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

import { ComponentType, useEffect, useState } from 'react';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';
import type { JsonValue } from '@backstage/types';
import {
  exampleArgs,
  WorkflowDetail,
  WorkflowMessageDefinition,
  WorkflowMessageDefinitionsResponse,
  WorkflowRunRef,
} from '../../common';
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
import {
  temporalApiRef,
  type TemporalWorkflowExtensionProps,
} from '../../extensions';
import { JsonView } from '../PayloadView';
import { tp } from '../styles';
import {
  ControlError,
  controlError,
  ControlErrorAlert,
  JsonArgsField,
  parseArgs,
} from './shared';

const NO_MESSAGE_DEFINITIONS: WorkflowMessageDefinitionsResponse = {
  signals: [],
  updates: [],
  queries: [],
};

/**
 * The message definitions of a workflow
 * (`GET .../message-definitions`). Undefined while loading or when `enabled` is
 * false; empty when the backend cannot tell.
 */
export function useWorkflowMessageDefinitions(
  ref: WorkflowRunRef,
  entityRef: string | undefined,
  enabled: boolean,
): WorkflowMessageDefinitionsResponse | undefined {
  const api = useApi(temporalApiRef);
  const [value, setValue] = useState<WorkflowMessageDefinitionsResponse>();
  const { namespace, workflowId, runId } = ref;
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    api
      .getWorkflowMessageDefinitions(
        { namespace, workflowId, runId },
        { entityRef },
      )
      .then(definitions => current && setValue(definitions))
      .catch(() => current && setValue(NO_MESSAGE_DEFINITIONS));
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

/** The signed-in user's entity reference, once known. */
export function useUserEntityRef(): string | undefined {
  const identityApi = useApi(identityApiRef);
  const [ref, setRef] = useState<string>();
  useEffect(() => {
    let current = true;
    identityApi
      .getBackstageIdentity()
      .then(identity => current && setRef(identity.userEntityRef))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [identityApi]);
  return ref;
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

/**
 * Signal, update or query: a name, the arguments, then the result.
 * `send` sends the message; the dialog shows its result unless
 * `showResult` is false. `argsField` replaces the JSON field, for example
 * with a form for message definitions with an input schema.
 */
export function MessageDialog(props: {
  /** `signal`, `update` or `query`; names the result's test ID. */
  kind: string;
  text: MessageDialogText;
  /** The message definitions to choose from. */
  messageDefinitions: WorkflowMessageDefinition[];
  allowsCustomValue: boolean;
  showResult?: boolean;
  argsField?: ComponentType<MessageArgsFieldProps>;
  send(request: {
    name: string;
    args: JsonValue[];
  }): Promise<{ result?: JsonValue }>;
  onClose(): void;
  /** The details page of the run, for the links of its errors. */
  context?: TemporalWorkflowExtensionProps;
}) {
  const { kind, text } = props;
  const ArgsField = props.argsField ?? JsonMessageArgsField;
  const userEntityRef = useUserEntityRef();
  const [name, setName] = useState(props.messageDefinitions[0]?.name ?? '');
  // The message definition names may come after the dialog opens.
  const firstOption = props.messageDefinitions[0]?.name;
  useEffect(() => {
    if (firstOption) setName(current => current || firstOption);
  }, [firstOption]);
  const messageDefinition = props.messageDefinitions.find(
    d => d.name === name.trim(),
  );
  const [parsed, setParsed] = useState<
    { args: JsonValue[] } | { error: string }
  >({ args: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ControlError>();
  const [done, setDone] = useState<{ result?: JsonValue; name: string }>();

  // The result is of the name it was sent for.
  const changeName = (value: string) => {
    setName(value);
    setDone(undefined);
  };

  const submit = async () => {
    if (!name.trim() || 'error' in parsed) return;
    setPending(true);
    setError(undefined);
    setDone(undefined);
    try {
      const sent = name.trim();
      const { result } = await props.send({ name: sent, args: parsed.args });
      setDone({ result, name: sent });
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
            description={messageDefinition?.description}
            options={props.messageDefinitions.map(d => ({
              value: d.name,
              label: d.name,
            }))}
            allowsCustomValue={props.allowsCustomValue}
            inputValue={name}
            onInputChange={changeName}
            onSelectionChange={key => key !== null && changeName(String(key))}
            isRequired
          />
          <ArgsField
            // A new field, with its example, for each described message definition.
            key={messageDefinition?.name ?? ''}
            messageDefinition={messageDefinition}
            userEntityRef={userEntityRef}
            onChange={setParsed}
          />
          {error && (
            <ControlErrorAlert
              error={error}
              context={props.context}
              showContinuedAsNew={kind === 'signal'}
            />
          )}
          {done && (
            <div data-testid={`workflow-${kind}-result`}>
              <Alert
                status="success"
                icon
                title={`${text.done} ${done.name}${text.doneSuffix}`}
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

/** Reference of a workflow run, from its details. */
export function refOf(workflow: WorkflowDetail): WorkflowRunRef {
  return {
    namespace: workflow.namespace,
    workflowId: workflow.workflowId,
    runId: workflow.runId,
  };
}
