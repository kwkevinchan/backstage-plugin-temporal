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

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { temporalApiRef } from '@kwkevinchan/backstage-plugin-temporal-frontend';
import { TemporalWorkflowPicker } from './components/TemporalWorkflowPicker';

const workflow = (workflowId: string) => ({
  namespace: 'default',
  workflowId,
  runId: `${workflowId}-run`,
  workflowType: 'demoRelease',
  status: 'Running' as const,
  startTime: '2026-11-10T12:00:00.000Z',
});

async function render(
  uiOptions: object,
  api: object,
  value?: string,
  extra?: { description?: string; rawErrors?: string[] },
) {
  const onChange = jest.fn();
  const props: any = {
    formData: value,
    onChange,
    schema: {
      title: 'Release to approve',
      type: 'string',
      description: extra?.description,
    },
    uiSchema: { 'ui:options': uiOptions },
    required: true,
    rawErrors: extra?.rawErrors ?? [],
  };
  const result = await renderInTestApp(
    <TestApiProvider apis={[[temporalApiRef, api as any]]}>
      <TemporalWorkflowPicker {...props} />
    </TestApiProvider>,
  );
  return { onChange, ...result };
}

describe('TemporalWorkflowPicker', () => {
  it('lists the running workflows of an entity waiting on an attribute', async () => {
    const api = {
      listEntityWorkflows: jest.fn().mockResolvedValue({
        items: [workflow('release-1'), workflow('release-2')],
      }),
      listWorkflows: jest.fn(),
    };
    const { onChange } = await render(
      {
        entityRef: 'temporalworkflow:default/demo-release',
        searchAttribute: 'ApprovalPending',
      },
      api,
    );
    expect(api.listEntityWorkflows).toHaveBeenCalledWith(
      'temporalworkflow:default/demo-release',
      { status: 'Running', searchAttribute: 'ApprovalPending', pageSize: 50 },
    );
    const select = await screen.findByRole('button', {
      name: /Release to approve/,
    });
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.click(select);
    await userEvent.click(
      await screen.findByRole('option', { name: /^release-2 · demoRelease/ }),
    );
    expect(onChange).toHaveBeenCalledWith('release-2');
  });

  it('lists a workflow type of any status without an entity', async () => {
    const api = {
      listEntityWorkflows: jest.fn(),
      listWorkflows: jest.fn().mockResolvedValue({ items: [] }),
    };
    await render({ workflowType: 'demoRelease', status: 'any' }, api);
    expect(api.listWorkflows).toHaveBeenCalledWith({
      namespace: undefined,
      workflowType: 'demoRelease',
      status: undefined,
      searchAttribute: undefined,
      pageSize: 50,
    });
    expect(await screen.findByText('No workflow matches.')).toBeInTheDocument();
  });

  it('clears a value that is no longer offered', async () => {
    const api = {
      listEntityWorkflows: jest
        .fn()
        .mockResolvedValue({ items: [workflow('release-1')] }),
      listWorkflows: jest.fn(),
    };
    const { onChange } = await render(
      { entityRef: 'temporalworkflow:default/demo-release' },
      api,
      'release-gone',
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
  });

  it('says when the workflows cannot be listed', async () => {
    const api = {
      listEntityWorkflows: jest.fn(),
      listWorkflows: jest.fn().mockRejectedValue(new Error('Forbidden')),
    };
    await render({ workflowType: 'demoRelease' }, api);
    expect(
      await screen.findByText(/could not be listed: Forbidden/),
    ).toBeInTheDocument();
  });

  it('passes explicit namespace and status and renders description and rawErrors', async () => {
    const api = {
      listEntityWorkflows: jest.fn(),
      listWorkflows: jest
        .fn()
        .mockResolvedValue({ items: [workflow('release-1')] }),
    };
    await render(
      {
        workflowType: 'demoRelease',
        namespace: 'payments',
        status: 'Completed',
      },
      api,
      undefined,
      {
        description: 'Pick the release workflow to approve.',
        rawErrors: ['Selection is required'],
      },
    );

    expect(api.listWorkflows).toHaveBeenCalledWith({
      namespace: 'payments',
      workflowType: 'demoRelease',
      status: 'Completed',
      searchAttribute: undefined,
      pageSize: 50,
    });
    expect(
      await screen.findByText('Pick the release workflow to approve.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Selection is required')).toBeInTheDocument();
  });

  it('ignores a response that arrives after the options changed', async () => {
    type Page = { items: ReturnType<typeof workflow>[] };
    let resolveFirst!: (value: Page) => void;
    const first = new Promise<Page>(resolve => {
      resolveFirst = resolve;
    });
    const api = {
      listEntityWorkflows: jest.fn(),
      listWorkflows: jest
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce({ items: [workflow('release-new')] }),
    };
    const onChange = jest.fn();
    const picker = (workflowType: string) => {
      const props: any = {
        formData: 'release-new',
        onChange,
        schema: { title: 'Release to approve', type: 'string' },
        uiSchema: { 'ui:options': { workflowType } },
        required: true,
        rawErrors: [],
      };
      return (
        <TestApiProvider apis={[[temporalApiRef, api as any]]}>
          <TemporalWorkflowPicker {...props} />
        </TestApiProvider>
      );
    };
    const { rerender } = await renderInTestApp(picker('oldRelease'));
    rerender(picker('newRelease'));
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
    expect(api.listWorkflows).toHaveBeenCalledTimes(2);

    // The first request answers last, with a list that does not offer the
    // value: it must not replace the list of the current options.
    await act(async () => {
      resolveFirst({ items: [workflow('release-old')] });
      await first;
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).not.toBeDisabled();
  });
});
