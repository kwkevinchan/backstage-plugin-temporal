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

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { mockServices } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import { ConfigReader } from '@backstage/config';
import { NotFoundError } from '@backstage/errors';
import { ScmIntegrations } from '@backstage/integration';
import { DefinitionReader, parseDefinition } from './definition';

const fixture = readFileSync(
  join(__dirname, '../../../../test-fixtures/definitions/every-task.yaml'),
  'utf8',
);

const entity = (location?: string): Entity => ({
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: {
    name: 'order-flow',
    namespace: 'default',
    annotations: location
      ? { 'backstage.io/managed-by-location': location }
      : {},
  },
  spec: { owner: 'group:default/team-a', workflowType: 'order-flow' },
});

const spec = (target: string) => ({
  format: 'serverless-workflow' as const,
  target,
});

function readerOf(
  readUrl: jest.Mock,
  options: { maxBytes?: number; readFileLocations?: boolean } = {},
) {
  return new DefinitionReader({
    reader: mockServices.urlReader.mock({ readUrl }),
    integrations: ScmIntegrations.fromConfig(new ConfigReader({})),
    ...options,
  });
}

describe('parseDefinition', () => {
  it('finds every task with its first and last line', () => {
    const { document, tasks, error } = parseDefinition(fixture);
    expect(error).toBeUndefined();
    expect((document as any).document.workflowType).toBe('order-flow');
    const byName = Object.fromEntries(
      tasks.map(t => [t.pointer, [t.startLine, t.endLine]]),
    );
    expect(byName['/do/0/validate']).toEqual([10, 14]);
    expect(byName['/do/2/packItems']).toEqual([22, 32]);
    expect(byName['/do/2/packItems/do/0/pack']).toEqual([28, 32]);
    expect(byName['/do/3/checks/fork/branches/1/stock']).toEqual([42, 52]);
    expect(byName['/do/3/checks/fork/branches/1/stock/do/0/reserve']).toEqual([
      44, 52,
    ]);
    expect(byName['/do/5/charge/try/0/chargeCard']).toEqual([62, 66]);
    expect(byName['/do/5/charge/catch/do/0/refund']).toEqual([74, 77]);
    expect(byName['/do/11/expressShipping']).toEqual([97, 103]);
    expect(tasks.map(t => t.name)).toEqual([
      'validate',
      'route',
      'packItems',
      'pack',
      'checks',
      'fraud',
      'stock',
      'reserve',
      'waitForPayment',
      'charge',
      'chargeCard',
      'refund',
      'cooldown',
      'notify',
      'summary',
      'mystery',
      'stop',
      'expressShipping',
      'book',
    ]);
  });

  it('reports the line of a syntax error', () => {
    const result = parseDefinition('document:\n  dsl: 1.0.0\ndo:\n  - a: [\n');
    expect(result.error).toMatchObject({ kind: 'parse' });
    expect(result.error?.line).toBeGreaterThanOrEqual(4);
    expect(result.tasks).toEqual([]);
  });

  it('stops alias bombs', () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    for (let i = 0; i < 8; i++) {
      const prev = String.fromCharCode(97 + i);
      const next = String.fromCharCode(98 + i);
      lines.push(`${next}: &${next} [${new Array(10).fill(`*${prev}`)}]`);
    }
    lines.push('do: []');
    const result = parseDefinition(lines.join('\n'));
    expect(result.error).toEqual({
      kind: 'parse',
      message: 'The file uses too many aliases (more than 100)',
    });
    expect(result.document).toBeUndefined();
  });

  it('keeps tags as data and runs nothing', () => {
    const result = parseDefinition(
      'document: {dsl: 1.0.0}\ndo:\n  - a:\n      set:\n        f: !!js/function "function () { throw 1 }"\n',
    );
    // An unknown tag is an error in strict mode or plain data otherwise;
    // never a function.
    const value = (result.document as any)?.do?.[0]?.a?.set?.f;
    expect(typeof value === 'function').toBe(false);
  });

  it('rejects duplicate keys and files that are not workflows', () => {
    expect(parseDefinition('a: 1\na: 2\n').error?.kind).toBe('parse');
    expect(parseDefinition('- 1\n- 2\n').error?.kind).toBe('format');
    expect(parseDefinition('document: {dsl: 1.0.0}\n').error).toEqual({
      kind: 'format',
      message: 'The file has no task list (do) at the top level',
    });
    expect(
      parseDefinition('document: {dsl: 0.8.0}\ndo: []\n').error?.message,
    ).toBe('DSL version 0.8.0 is not supported; the page reads 1.x');
  });
});

describe('DefinitionReader', () => {
  it('reads a target relative to the entity location', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from(fixture),
      stream: () => Readable.from([Buffer.from(fixture)]),
    }));
    const reader = readerOf(readUrl);
    const result = await reader.read(
      entity(
        'url:https://git.example.com/org/repo/blob/main/catalog-info.yaml',
      ),
      spec('./workflows/order.yaml'),
    );
    expect(readUrl).toHaveBeenCalledWith(
      'https://git.example.com/org/repo/blob/main/workflows/order.yaml',
    );
    expect(result).toMatchObject({
      entityRef: 'temporalworkflow:default/order-flow',
      format: 'serverless-workflow',
      target: './workflows/order.yaml',
      url: 'https://git.example.com/org/repo/blob/main/workflows/order.yaml',
      size: Buffer.byteLength(fixture),
      maxBytes: 1024 * 1024,
    });
    expect(result.content).toBe(fixture);
    expect(result.tasks).toHaveLength(19);
    expect(result.error).toBeUndefined();
  });

  it('reads source code and marks the function of the workflow', async () => {
    const source =
      "import { sleep } from '@temporalio/workflow';\n\nexport async function orderFlow() {\n  await sleep(1);\n}\n";
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from(source),
      stream: () => Readable.from([Buffer.from(source)]),
    }));
    const workflowEntity = entity(
      'url:https://git.example.com/org/repo/blob/main/catalog-info.yaml',
    );
    const read = (symbol?: string) =>
      readerOf(readUrl).read(workflowEntity, {
        format: 'source',
        target: './src/workflows.ts',
        ...(symbol ? { symbol } : {}),
      });
    const result = await read('orderFlow');
    expect(result).toMatchObject({
      format: 'source',
      language: 'typescript',
      symbol: 'orderFlow',
      symbolLines: { startLine: 3, endLine: 5 },
      content: source,
      tasks: [],
    });
    expect(result.error).toBeUndefined();
    // Without a symbol: the workflow type, which is not in this file.
    const byType = await read();
    expect(byType.symbol).toBe('order-flow');
    expect(byType.symbolLines).toBeUndefined();
  });

  it('reads an absolute URL as it is', async () => {
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.from('document: {dsl: 1.0.0}\ndo: []\n'),
    }));
    const result = await readerOf(readUrl).read(
      entity(),
      spec('https://raw.example.com/order.yaml'),
    );
    expect(readUrl).toHaveBeenCalledWith('https://raw.example.com/order.yaml');
    expect(result.error).toBeUndefined();
  });

  it('stops reading at the size limit', async () => {
    const big = Buffer.alloc(64, 'a');
    const stream = Readable.from([big, big, big]);
    const readUrl = jest.fn(async () => ({
      buffer: async () => Buffer.concat([big, big, big]),
      stream: () => stream,
    }));
    const result = await readerOf(readUrl, { maxBytes: 100 }).read(
      entity(),
      spec('https://raw.example.com/order.yaml'),
    );
    expect(result.error).toEqual({
      kind: 'tooLarge',
      message: 'The file is larger than 100 bytes',
    });
    expect(result.content).toBeUndefined();
    expect(stream.destroyed).toBe(true);

    const noStream = jest.fn(async () => ({
      buffer: async () => Buffer.concat([big, big]),
    }));
    expect(
      (
        await readerOf(noStream, { maxBytes: 100 }).read(
          entity(),
          spec('https://raw.example.com/order.yaml'),
        )
      ).error?.kind,
    ).toBe('tooLarge');
  });

  it('reports files that cannot be read', async () => {
    const missing = jest.fn(async () => {
      throw new NotFoundError('nope');
    });
    expect(
      (
        await readerOf(missing).read(
          entity(),
          spec('https://raw.example.com/order.yaml'),
        )
      ).error,
    ).toEqual({ kind: 'read', message: 'The file was not found' });

    const notAllowed = jest.fn(async () => {
      throw new Error('Reading from https://evil.example.com is not allowed');
    });
    const result = await readerOf(notAllowed).read(
      entity(),
      spec('https://evil.example.com/order.yaml'),
    );
    expect(result.error?.kind).toBe('read');
    expect(result.error?.message).toContain('integrations');
  });

  it('accepts only http and https URLs and needs a location for paths', async () => {
    const readUrl = jest.fn();
    const reader = readerOf(readUrl);
    expect(
      (await reader.read(entity(), spec('ftp://example.com/a.yaml'))).error,
    ).toEqual({ kind: 'read', message: 'Only http and https URLs are read' });
    expect(
      (await reader.read(entity(), spec('./a.yaml'))).error?.message,
    ).toContain('no location');
    expect(
      (await reader.read(entity('file:/catalog/entities.yaml'), spec('a.yaml')))
        .error?.message,
    ).toContain('temporal.definitions.readFileLocations');
    expect(readUrl).not.toHaveBeenCalled();
  });

  it('reads files next to a file location only when allowed and inside its folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-def-'));
    try {
      mkdirSync(join(dir, 'workflows'));
      writeFileSync(join(dir, 'workflows', 'order.yaml'), fixture);
      writeFileSync(join(dir, 'big.yaml'), Buffer.alloc(200, 'a'));
      const reader = readerOf(jest.fn(), {
        readFileLocations: true,
        maxBytes: 150 + fixture.length,
      });
      const location = `file:${join(dir, 'entities.yaml')}`;
      const ok = await reader.read(
        entity(location),
        spec('./workflows/order.yaml'),
      );
      expect(ok.error).toBeUndefined();
      expect(ok.url).toBeUndefined();
      expect(ok.tasks).toHaveLength(19);
      expect(
        (await reader.read(entity(location), spec('../outside.yaml'))).error
          ?.message,
      ).toContain('stay in the folder');
      expect(
        (await reader.read(entity(location), spec('missing.yaml'))).error,
      ).toEqual({ kind: 'read', message: 'The file was not found' });
      const small = readerOf(jest.fn(), {
        readFileLocations: true,
        maxBytes: 100,
      });
      expect(
        (await small.read(entity(location), spec('big.yaml'))).error?.kind,
      ).toBe('tooLarge');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('checks the configured limit', () => {
    const urlReader = mockServices.urlReader.mock();
    expect(
      DefinitionReader.fromConfig(new ConfigReader({}), urlReader).maxBytes,
    ).toBe(1024 * 1024);
    expect(() =>
      DefinitionReader.fromConfig(
        new ConfigReader({ temporal: { definitions: { maxBytes: 0 } } }),
        urlReader,
      ),
    ).toThrow('temporal.definitions.maxBytes');
  });
});
