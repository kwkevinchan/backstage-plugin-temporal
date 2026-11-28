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
import { useApi } from '@backstage/core-plugin-api';
import type { JsonValue } from '@backstage/types';
import type {
  WorkflowGraphNode,
  WorkflowLlmCallResponse,
  WorkflowLlmMessage,
  WorkflowLlmPart,
  WorkflowLlmRecord,
  WorkflowLlmToolCallRef,
  WorkflowNodeStatus,
  WorkflowRunRef,
} from '../../common';
import { temporalApiRef } from '../../extensions';
import { Button, Flex, Switch, Text } from '@backstage/ui';
import {
  RiArrowRightLine,
  RiRobot2Line,
  RiSettings3Line,
  RiToolsLine,
  RiUser3Line,
} from '@remixicon/react';
import { ErrorAlert, Loading } from '../feedback';
import { FailureView } from '../FailureView';
import { CopyButton } from '../CopyButton';
import { ExternalPayloadView } from '../ExternalPayloadView';
import { JsonView, PayloadView } from '../PayloadView';
import { WorkflowStatusLabel } from '../WorkflowStatusLabel';
import { tp } from '../styles';
import {
  formatCallDuration,
  formatTokens,
  INFERRED_LINK_TEXT,
  llmCallName,
  modelText,
} from './llmText';

/** Text longer than this (characters or lines) starts collapsed. */
const CLAMP_CHARS = 600;
const CLAMP_LINES = 8;
/** Longest text put on the page; its copy button copies all of it. */
export const MAX_TEXT_CHARS = 50_000;
/**
 * Most messages, parts of a message, reasoning parts or tool calls put on
 * the page; the copy button of the section copies all of them.
 */
export const MAX_ITEMS = 200;

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** The first `max` characters of `text`, without cutting a character in two. */
function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  // A high surrogate: the first half of a character outside the BMP.
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Says how many items of a list are not on the page. */
function NotShown(props: { hidden: number; one: string; many: string }) {
  if (props.hidden <= 0) return null;
  return (
    <Text
      as="p"
      variant="body-small"
      color="secondary"
      data-testid="llm-not-shown"
    >
      {count(props.hidden)} more {props.hidden === 1 ? props.one : props.many}{' '}
      not shown. The copy button of the section copies all of them.
    </Text>
  );
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** The text the copy button of a section copies: the JSON, or the text. */
function copyText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function Section(props: {
  title: string;
  testId: string;
  copy?: unknown;
  children: ReactNode;
}) {
  return (
    <section className={tp('tp-section')} data-testid={props.testId}>
      <div className={tp('tp-llm-section-head')}>
        <Text as="h4" variant="title-x-small">
          {props.title}
        </Text>
        {props.copy !== undefined && (
          <CopyButton
            text={copyText(props.copy)}
            label={`Copy ${props.title.toLocaleLowerCase('en-US')}`}
          />
        )}
      </div>
      {props.children}
    </section>
  );
}

/**
 * Long text, collapsed to a few lines with a button to show more. At most
 * {@link MAX_TEXT_CHARS} characters are put on the page; a longer text says
 * so and has a button that copies all of it.
 */
export function LongText(props: { text: string; testId?: string }) {
  const { text } = props;
  const shown = head(text, MAX_TEXT_CHARS);
  const truncated = shown.length < text.length;
  const long =
    shown.length > CLAMP_CHARS || shown.split('\n').length > CLAMP_LINES;
  const [open, setOpen] = useState(false);
  let more = `Show all (${text.length} characters)`;
  if (truncated) {
    more = `Show the first ${count(shown.length)} of ${count(
      text.length,
    )} characters`;
  }
  return (
    <div>
      <p
        className={tp('tp-llm-text')}
        data-clamped={long && !open}
        data-testid={props.testId}
      >
        {shown}
      </p>
      {long && (
        <Button
          size="small"
          variant="tertiary"
          className={tp('tp-llm-more')}
          onPress={() => setOpen(!open)}
        >
          {open ? 'Show less' : more}
        </Button>
      )}
      {truncated && open && (
        <Flex align="center" gap="1" data-testid="llm-text-truncated">
          <Text variant="body-small" color="secondary">
            Showing the first {count(shown.length)} of {count(text.length)}{' '}
            characters.
          </Text>
          <CopyButton text={text} label="Copy the full text" />
        </Flex>
      )}
    </div>
  );
}

/** One part of a message. */
function Part(props: { part: WorkflowLlmPart }) {
  const { part } = props;
  switch (part.type) {
    case 'text':
      return <LongText text={asText(part.content ?? '')} />;
    case 'reasoning':
      return (
        <details className={tp('tp-llm-thinking')}>
          <summary>Reasoning</summary>
          <LongText text={asText(part.content ?? '')} />
        </details>
      );
    case 'tool_call':
      return (
        <div>
          <Text as="p" variant="body-small" color="secondary">
            Tool call{' '}
            <span className={tp('tp-llm-tool-name')}>{String(part.name)}</span>
            {part.id ? ` (${String(part.id)})` : ''}
          </Text>
          <JsonView value={(part.arguments ?? null) as JsonValue} />
        </div>
      );
    case 'tool_call_response':
      return (
        <div>
          <Text as="p" variant="body-small" color="secondary">
            Tool result{part.id ? ` for ${String(part.id)}` : ''}
          </Text>
          {typeof part.response === 'string' ? (
            <LongText text={part.response} />
          ) : (
            <JsonView value={(part.response ?? null) as JsonValue} />
          )}
        </div>
      );
    case 'file':
      return (
        <Text as="p" variant="body-small" color="secondary">
          {filePartText(part)}
        </Text>
      );
    default:
      return (
        <div>
          <Text as="p" variant="body-small" color="secondary">
            {part.type}
          </Text>
          <JsonView value={part} />
        </div>
      );
  }
}

/**
 * A file part by what it has: the modality (or "file"), the file ID or the
 * name (the Vercel AI SDK adapter sets a name, not an ID) and the MIME type.
 */
function filePartText(part: WorkflowLlmPart): string {
  const identity = part.file_id ?? part.name;
  return [
    String(part.modality ?? 'file'),
    identity ? `: ${String(identity)}` : '',
    part.mime_type ? ` (${String(part.mime_type)})` : '',
  ].join('');
}

function RoleIcon(props: { role: string }) {
  const p = { size: 14, 'aria-hidden': true };
  switch (props.role) {
    case 'assistant':
      return <RiRobot2Line {...p} />;
    case 'system':
      return <RiSettings3Line {...p} />;
    case 'tool':
      return <RiToolsLine {...p} />;
    default:
      return <RiUser3Line {...p} />;
  }
}

/** Messages as a chat: one card per message, its role on top. */
function Messages(props: { messages: WorkflowLlmMessage[] }) {
  return (
    <div className={tp('tp-llm-messages')}>
      {props.messages.slice(0, MAX_ITEMS).map((m, i) => (
        <div
          key={i}
          className={tp('tp-llm-message')}
          data-role={m.role}
          data-testid="llm-message"
        >
          <div className={tp('tp-llm-role')}>
            <RoleIcon role={m.role} />
            {m.role}
            {m.name ? ` · ${m.name}` : ''}
          </div>
          <Flex direction="column" gap="2">
            {m.parts.slice(0, MAX_ITEMS).map((part, j) => (
              <Part key={j} part={part} />
            ))}
            <NotShown
              hidden={m.parts.length - MAX_ITEMS}
              one="part of this message is"
              many="parts of this message are"
            />
            {m.parts.length === 0 && (
              <Text variant="body-small" color="secondary">
                (empty)
              </Text>
            )}
          </Flex>
        </div>
      ))}
      <NotShown
        hidden={props.messages.length - MAX_ITEMS}
        one="message is"
        many="messages are"
      />
    </div>
  );
}

interface ToolCard {
  id?: string;
  name: string;
  arguments?: JsonValue;
  ref?: WorkflowLlmToolCallRef;
  node?: WorkflowGraphNode;
}

/** Tool calls of the output with their steps. */
function toolCards(
  record: WorkflowLlmRecord | undefined,
  step: WorkflowGraphNode,
  nodes: WorkflowGraphNode[],
): ToolCard[] {
  const refs = step.llm?.toolCalls ?? [];
  const cards: ToolCard[] = [];
  const used = new Set<WorkflowLlmToolCallRef>();
  const refFor = (id: string | undefined, name: string) => {
    const ref =
      refs.find(r => !used.has(r) && id !== undefined && r.id === id) ??
      refs.find(r => !used.has(r) && r.id === undefined && r.name === name);
    if (ref) used.add(ref);
    return ref;
  };
  for (const m of record?.outputMessages ?? []) {
    for (const p of m.parts) {
      if (p.type !== 'tool_call') continue;
      const id = typeof p.id === 'string' ? p.id : undefined;
      const name = String(p.name ?? 'tool');
      cards.push({
        id,
        name,
        arguments: (p.arguments ?? null) as JsonValue,
        ref: refFor(id, name),
      });
    }
  }
  // Without a record: the tool calls from the summary.
  for (const r of refs) {
    if (used.has(r) || cards.some(c => c.ref === r)) continue;
    cards.push({ id: r.id, name: r.name, ref: r });
  }
  for (const card of cards) {
    if (card.ref?.nodeId)
      card.node = nodes.find(n => n.id === card.ref!.nodeId);
  }
  return cards;
}

function cardStatus(card: ToolCard): WorkflowNodeStatus | undefined {
  return card.node?.status ?? card.ref?.status;
}

/** The response of a tool call: from its step. */
function ToolResponse(props: { card: ToolCard }) {
  const { node } = props.card;
  if (!node) return null;
  if (node.failure) return <FailureView failure={node.failure} />;
  return <PayloadView payload={node.result} />;
}

function ToolCards(props: { cards: ToolCard[]; onSelect?(id: string): void }) {
  if (props.cards.length === 0) {
    return (
      <Text as="p" variant="body-small" color="secondary">
        The model asked for no tools.
      </Text>
    );
  }
  return (
    <div className={tp('tp-llm-tools')}>
      {props.cards.slice(0, MAX_ITEMS).map((card, i) => {
        const status = cardStatus(card);
        return (
          <div
            key={`${card.id ?? card.name}-${i}`}
            className={tp('tp-llm-tool')}
            data-testid="llm-tool-card"
          >
            <div className={tp('tp-llm-tool-head')}>
              <RiToolsLine
                size={14}
                aria-hidden
                className={tp('tp-llm-icon')}
              />
              <span className={tp('tp-llm-tool-name')}>{card.name}</span>
              {status && <WorkflowStatusLabel status={status} />}
              {card.node && card.ref?.inferred && (
                <span
                  className={tp('tp-llm-tag')}
                  title="Matched by the tool name, the arguments and the order of the steps: the step recorded no tool call ID"
                  data-testid="llm-tool-inferred"
                >
                  {INFERRED_LINK_TEXT}
                </span>
              )}
              {card.node && card.node.attempt && card.node.attempt > 1 && (
                <span className={tp('tp-llm-tag')}>
                  Attempt {card.node.attempt}
                </span>
              )}
              {card.node && props.onSelect && (
                <Button
                  size="small"
                  variant="secondary"
                  iconEnd={<RiArrowRightLine />}
                  style={{ marginLeft: 'auto' }}
                  onPress={() => props.onSelect!(card.node!.id)}
                  aria-label={`Go to the step of ${card.name}`}
                >
                  Go to step
                </Button>
              )}
            </div>
            {card.id && (
              <Text as="p" variant="body-x-small" color="secondary">
                ID {card.id}
              </Text>
            )}
            {card.arguments !== undefined && (
              <>
                <Text as="p" variant="body-small" color="secondary">
                  Arguments
                </Text>
                <JsonView
                  value={card.arguments ?? null}
                  open={JSON.stringify(card.arguments ?? null).length > 80}
                />
              </>
            )}
            {card.node && (
              <Text as="p" variant="body-small" color="secondary">
                Response
              </Text>
            )}
            <ToolResponse card={card} />
          </div>
        );
      })}
      <NotShown
        hidden={props.cards.length - MAX_ITEMS}
        one="tool call is"
        many="tool calls are"
      />
    </div>
  );
}

function UsageTiles(props: {
  step: WorkflowGraphNode;
  record?: WorkflowLlmRecord;
}) {
  const summary = props.step.llm!;
  const usage = props.record?.usage ?? summary.usage ?? {};
  const duration = props.record?.durationMs ?? summary.durationMs;
  const items: [string, string][] = [
    ['Input tokens', formatTokens(usage.inputTokens)],
    ['Output tokens', formatTokens(usage.outputTokens)],
    ['Reasoning tokens', formatTokens(usage.reasoningTokens)],
    ['Cached input', formatTokens(usage.cacheReadInputTokens)],
    ['Cache write', formatTokens(usage.cacheWriteInputTokens)],
    ['Duration', formatCallDuration(duration)],
  ];
  const shown = items.filter(([, v]) => v !== '');
  return (
    <>
      <div className={tp('tp-llm-usage')} data-testid="llm-usage-tiles">
        {shown.map(([label, value]) => (
          <div key={label}>
            <span className={tp('tp-llm-usage-label')}>{label}</span>
            <span className={tp('tp-llm-usage-value')}>{value}</span>
          </div>
        ))}
      </div>
      {shown.length === 0 && (
        <Text as="p" variant="body-small" color="secondary">
          No token counts were recorded.
        </Text>
      )}
    </>
  );
}

function hasRequestDetails(record: WorkflowLlmRecord): boolean {
  return (
    record.responseId !== undefined ||
    record.parameters !== undefined ||
    record.toolDefinitions !== undefined
  );
}

/** What the call was sent with and the ID the provider gave the response. */
function RequestDetails(props: { record: WorkflowLlmRecord }) {
  const { responseId, parameters, toolDefinitions } = props.record;
  return (
    <Flex direction="column" gap="2">
      {responseId !== undefined && (
        <Text as="p" variant="body-small" color="secondary">
          Response ID{' '}
          <span
            className={tp('tp-llm-tool-name')}
            data-testid="llm-response-id"
          >
            {responseId}
          </span>
        </Text>
      )}
      {parameters !== undefined && (
        <div data-testid="llm-parameters">
          <Text as="p" variant="body-small" color="secondary">
            Parameters
          </Text>
          <JsonView value={parameters} />
        </div>
      )}
      {toolDefinitions !== undefined && (
        <div data-testid="llm-tool-definitions">
          <Text as="p" variant="body-small" color="secondary">
            Tool definitions ({toolDefinitions.length})
          </Text>
          <JsonView value={toolDefinitions} />
        </div>
      )}
    </Flex>
  );
}

/** Loads the full record of a model call. */
function useLlmCall(
  ref: WorkflowRunRef | undefined,
  step: WorkflowGraphNode,
  entityRef: string | undefined,
  enabled: boolean,
) {
  const api = useApi(temporalApiRef);
  const [state, setState] = useState<{
    data?: WorkflowLlmCallResponse;
    error?: Error;
    loading: boolean;
  }>({ loading: enabled });
  const key = `${ref?.namespace}/${ref?.workflowId}/${ref?.runId}/${step.id}/${step.status}`;
  useEffect(() => {
    if (!enabled || !ref) {
      setState({ loading: false });
      return undefined;
    }
    let current = true;
    setState(s => ({
      data: s.data?.nodeId === step.id ? s.data : undefined,
      loading: true,
    }));
    api.getLlmCall(ref, step.id, { entityRef }).then(
      data => current && setState({ data, loading: false }),
      error => current && setState({ error, loading: false }),
    );
    return () => {
      current = false;
    };
    // The key holds the parts of ref and step that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, entityRef, enabled]);
  return state;
}

/**
 * The LLM panel of a model call: input (system instructions and messages),
 * thinking, output, tool calls and usage, each with a copy button, and the
 * record as raw JSON.
 */
export function LlmPanel(props: {
  step: WorkflowGraphNode;
  nodes: WorkflowGraphNode[];
  workflowRef?: WorkflowRunRef;
  entityRef?: string;
  onSelectStep?(id: string): void;
}) {
  const { step } = props;
  const summary = step.llm!;
  const { data, error, loading } = useLlmCall(
    props.workflowRef,
    step,
    props.entityRef,
    summary.record !== 'pending',
  );
  const [raw, setRaw] = useState(false);
  const record = data?.record;
  const cards = toolCards(record, step, props.nodes);
  const reasoning = (record?.outputMessages ?? []).flatMap(m =>
    m.parts.filter(p => p.type === 'reasoning'),
  );
  const output = (record?.outputMessages ?? [])
    .map(m => ({
      ...m,
      parts: m.parts.filter(
        p => p.type !== 'reasoning' && p.type !== 'tool_call',
      ),
    }))
    .filter(m => m.parts.length > 0);
  const input: WorkflowLlmMessage[] = [
    ...(record && record.systemInstructions.length > 0
      ? [{ role: 'system', parts: record.systemInstructions }]
      : []),
    ...(record?.inputMessages ?? []),
  ];
  const facts = [
    modelText(summary),
    summary.provider,
    record?.finishReasons?.length
      ? `finish: ${record.finishReasons.join(', ')}`
      : '',
  ].filter(Boolean);

  return (
    <div data-testid="llm-panel">
      <Flex align="center" gap="2" style={{ flexWrap: 'wrap' }}>
        <span className={tp('tp-llm-tag')}>LLM call {llmCallName(step)}</span>
        <span className={tp('tp-llm-tag')} data-testid="llm-framework">
          {summary.framework}
        </span>
        <Text variant="body-small" color="secondary">
          {facts.join(' · ')}
        </Text>
        {data?.raw !== undefined && (
          <div style={{ marginLeft: 'auto' }}>
            <Switch label="Raw JSON" isSelected={raw} onChange={setRaw} />
          </div>
        )}
      </Flex>

      {loading && !data && <Loading label="Loading the model call" />}
      {error && (
        <ErrorAlert title="Could not load the model call" error={error} />
      )}
      {data?.unavailable && (
        <Text
          as="p"
          variant="body-small"
          color="secondary"
          data-testid="llm-unavailable"
        >
          {data.unavailable}
        </Text>
      )}
      {data?.external && <ExternalPayloadView external={data.external} />}
      {summary.record === 'pending' && (
        <Text as="p" variant="body-small" color="secondary">
          The model call has not ended; its record is written when it does.
        </Text>
      )}

      {raw && data?.raw !== undefined ? (
        <Section title="Raw record" testId="llm-raw" copy={data.raw}>
          <JsonView value={data.raw} open />
        </Section>
      ) : (
        <>
          {record && (
            <Section
              title="Input"
              testId="llm-input"
              copy={{
                systemInstructions: record.systemInstructions,
                messages: record.inputMessages,
              }}
            >
              {input.length > 0 ? (
                <Messages messages={input} />
              ) : (
                <Text variant="body-small" color="secondary">
                  No input was recorded.
                </Text>
              )}
            </Section>
          )}
          {record && (
            <Section
              title="Thinking"
              testId="llm-thinking"
              copy={
                reasoning.length > 0
                  ? reasoning.map(p => asText(p.content)).join('\n\n')
                  : undefined
              }
            >
              {reasoning.length > 0 ? (
                <details
                  className={tp('tp-llm-thinking')}
                  data-testid="llm-thinking-details"
                >
                  <summary>
                    Reasoning
                    {record.usage.reasoningTokens
                      ? ` (${formatTokens(
                          record.usage.reasoningTokens,
                        )} tokens)`
                      : ''}
                  </summary>
                  {reasoning.slice(0, MAX_ITEMS).map((p, i) => (
                    <LongText key={i} text={asText(p.content ?? '')} />
                  ))}
                  <NotShown
                    hidden={reasoning.length - MAX_ITEMS}
                    one="reasoning part is"
                    many="reasoning parts are"
                  />
                </details>
              ) : (
                <Text variant="body-small" color="secondary">
                  {record.usage.reasoningTokens
                    ? `${formatTokens(
                        record.usage.reasoningTokens,
                      )} reasoning tokens; the reasoning itself was not returned.`
                    : 'No reasoning in the output.'}
                </Text>
              )}
            </Section>
          )}
          {record && (
            <Section
              title="Output"
              testId="llm-output"
              copy={record.outputMessages}
            >
              {record.error && (
                <Text as="p" variant="body-small" color="danger">
                  {record.error.type ? `${record.error.type}: ` : ''}
                  {record.error.message}
                </Text>
              )}
              {output.length > 0 ? (
                <Messages messages={output} />
              ) : (
                <Text variant="body-small" color="secondary">
                  {cards.length > 0 ? 'Tool calls only.' : 'No output.'}
                </Text>
              )}
            </Section>
          )}
          <Section
            title="Tool calls"
            testId="llm-tools"
            copy={
              cards.length > 0
                ? cards.map(c => ({
                    id: c.id,
                    name: c.name,
                    arguments: c.arguments,
                  }))
                : undefined
            }
          >
            <ToolCards cards={cards} onSelect={props.onSelectStep} />
          </Section>
          <Section
            title="Usage"
            testId="llm-usage"
            copy={record?.usage ?? summary.usage}
          >
            <UsageTiles step={step} record={record} />
          </Section>
          {record && hasRequestDetails(record) && (
            <Section
              title="Details"
              testId="llm-details"
              copy={{
                responseId: record.responseId,
                parameters: record.parameters,
                toolDefinitions: record.toolDefinitions,
              }}
            >
              <RequestDetails record={record} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
