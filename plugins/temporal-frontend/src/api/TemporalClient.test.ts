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

import { mockApis } from '@backstage/test-utils';
import {
  BACKEND_MISSING_MESSAGE,
  OPERATION_NOT_SERVED_MESSAGE,
  TemporalClient,
} from './TemporalClient';

const ref = { namespace: 'default', workflowId: 'wf-1', runId: 'run-1' };

function clientAnswering(response: () => Response) {
  return new TemporalClient({
    discoveryApi: mockApis.discovery(),
    fetchApi: { fetch: async () => response() },
  });
}

const noBody = () => new Response('Not Found', { status: 404 });
const withBody = () =>
  new Response(
    JSON.stringify({
      error: { name: 'NotFoundError', message: 'No such workflow' },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );

describe('TemporalClient errors', () => {
  it('names temporal.control.enabled when an operation finds no route', async () => {
    const client = clientAnswering(noBody);
    await expect(client.cancelWorkflow(ref)).rejects.toThrow(
      OPERATION_NOT_SERVED_MESSAGE,
    );
    expect(OPERATION_NOT_SERVED_MESSAGE).toMatch(/temporal\.control\.enabled/);
    await expect(client.startWorkflow({} as any)).rejects.toThrow(
      OPERATION_NOT_SERVED_MESSAGE,
    );
  });

  it('keeps the missing backend message for reads and queries', async () => {
    const client = clientAnswering(noBody);
    await expect(client.getWorkflow(ref)).rejects.toThrow(
      BACKEND_MISSING_MESSAGE,
    );
    await expect(client.queryWorkflow(ref, { name: 'q' })).rejects.toThrow(
      BACKEND_MISSING_MESSAGE,
    );
  });

  it('keeps the error of the backend when the 404 has an error body', async () => {
    const client = clientAnswering(withBody);
    for (const call of [
      () => client.cancelWorkflow(ref),
      () => client.getWorkflow(ref),
    ]) {
      const error = await call().catch(e => e);
      expect(error.name).toBe('ResponseError');
      expect(error.message).not.toBe(OPERATION_NOT_SERVED_MESSAGE);
      expect(error.message).not.toBe(BACKEND_MISSING_MESSAGE);
    }
  });
});
