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
  Component,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import Form from '@rjsf/core';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import type { JsonObject, JsonValue } from '@backstage/types';
import { Text } from '@backstage/ui';
import {
  messageDefinitionExampleArgs,
  JsonMessageArgsField,
  type MessageArgsFieldProps,
} from './MessageDialog';
import { tp } from '../styles';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Largest input schema shown as a form: its JSON, in characters. */
export const MAX_SCHEMA_CHARS = 64 * 1024;
/** Deepest input schema shown as a form: objects and arrays inside each other. */
export const MAX_SCHEMA_DEPTH = 32;

function deeperThan(value: unknown, limit: number): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (limit === 0) return true;
  return Object.values(value).some(v => deeperThan(v, limit - 1));
}

/**
 * Why an input schema is not shown as a form, or undefined when it can be.
 * The schema comes from the catalog, so its size is limited, and it is
 * compiled once here: a schema that is not valid, or a page whose Content
 * Security Policy has no `'unsafe-eval'` (ajv compiles schemas with
 * `new Function`), gives the JSON field instead of an error.
 */
function unusableSchema(schema: JsonObject): string | undefined {
  if (deeperThan(schema, MAX_SCHEMA_DEPTH)) {
    return `The input schema is nested more than ${MAX_SCHEMA_DEPTH} levels deep.`;
  }
  if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) {
    return `The input schema is larger than ${MAX_SCHEMA_CHARS} characters.`;
  }
  const { validationError } = validator.rawValidation(schema, undefined);
  return validationError
    ? 'The input schema could not be compiled.'
    : undefined;
}

function FallbackField(props: MessageArgsFieldProps & { reason: string }) {
  const { reason, ...field } = props;
  return (
    <>
      <Text
        as="p"
        variant="body-small"
        color="secondary"
        data-testid="message-form-fallback"
      >
        {reason} Enter the arguments as JSON.
      </Text>
      <JsonMessageArgsField {...field} />
    </>
  );
}

/** Shows `fallback` when the form throws while it renders. */
class FormBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  static getDerivedStateFromError() {
    return { failed: true };
  }

  state = { failed: false };

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The arguments field of the signal, update and query dialogs: a form for a
 * message definition with an input schema (from `spec.messages`), the JSON field
 * otherwise. The form gives the message's one argument. A schema that is too
 * large or too deep, cannot be compiled, or makes the form fail gives the
 * JSON field with a note.
 */
export function SchemaArgsField(props: MessageArgsFieldProps) {
  const schema = props.messageDefinition?.inputSchema;
  const reason = useMemo(
    () => (schema ? unusableSchema(schema) : undefined),
    [schema],
  );
  if (!schema) return <JsonMessageArgsField {...props} />;
  if (reason) return <FallbackField {...props} reason={reason} />;
  return (
    <FormBoundary
      fallback={
        <FallbackField
          {...props}
          reason="The form of the input schema could not be shown."
        />
      }
    >
      <SchemaForm {...props} schema={schema} />
    </FormBoundary>
  );
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
