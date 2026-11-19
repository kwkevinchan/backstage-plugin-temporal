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

import { useEffect, useId, useMemo, useState } from 'react';
import Form from '@rjsf/core';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import type { JsonObject, JsonValue } from '@backstage/types';
import {
  messageDefinitionExampleArgs,
  JsonMessageArgsField,
  type MessageArgsFieldProps,
} from './MessageDialog';
import { tp } from '../styles';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The arguments field of the signal, update and query dialogs: a form for a
 * message definition with an input schema (from `spec.messages`), the JSON field
 * otherwise. The form gives the message's one argument.
 */
export function SchemaArgsField(props: MessageArgsFieldProps) {
  if (!props.messageDefinition?.inputSchema)
    return <JsonMessageArgsField {...props} />;
  return <SchemaForm {...props} schema={props.messageDefinition.inputSchema} />;
}

function SchemaForm(props: MessageArgsFieldProps & { schema: JsonObject }) {
  const { messageDefinition, userEntityRef, onChange } = props;
  const schema = props.schema as RJSFSchema;
  const field = messageDefinition?.userField;
  // rjsf's default ID prefix is `root`, the ID of the element Backstage
  // mounts the app in: the labels would point there.
  const idPrefix = `tp-message-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const [data, setData] = useState<JsonValue | undefined>(() => {
    const [first] = messageDefinitionExampleArgs(
      messageDefinition,
      userEntityRef,
    );
    return first ?? (schema.type === 'object' ? {} : undefined);
  });
  // The user's reference may come after the form opens.
  useEffect(() => {
    if (!field || !userEntityRef) return;
    setData(current => ({
      ...(isObject(current) ? current : {}),
      [field]: userEntityRef,
    }));
  }, [field, userEntityRef]);
  useEffect(() => {
    const { errors } = validator.validateFormData(data, schema);
    onChange(
      errors.length > 0
        ? { error: errors[0].stack }
        : { args: [data === undefined ? null : data] },
    );
  }, [data, schema, onChange]);
  const uiSchema = useMemo<UiSchema>(
    () => ({
      'ui:submitButtonOptions': { norender: true },
      ...(field ? { [field]: { 'ui:readonly': true } } : {}),
    }),
    [field],
  );
  return (
    <div className={tp('tp-schema-form')} data-testid="message-form">
      <Form
        tagName="div"
        idPrefix={idPrefix}
        schema={schema}
        uiSchema={uiSchema}
        formData={data}
        validator={validator}
        liveValidate
        showErrorList={false}
        onChange={event => setData(event.formData as JsonValue | undefined)}
      />
    </div>
  );
}
